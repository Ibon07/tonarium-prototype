using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Threading;
using Tonarium.Desktop.Core;

internal sealed class SyncApp : Application { }
internal static class Program
{
    [STAThread] public static int Main(string[] args)
    {
        AppBuilder.Configure<SyncApp>().UsePlatformDetect().SetupWithoutStarting();
        using var quit = new CancellationTokenSource();
        var task = Task.Run(() => Run(args));
        _ = task.ContinueWith(_ => Dispatcher.UIThread.Post(quit.Cancel));
        Dispatcher.UIThread.MainLoop(quit.Token);
        try { task.GetAwaiter().GetResult(); return 0; }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
    private static async Task Run(string[] args)
    {
        var url = args[0]; var output = args[1]; var baseline = args.Contains("--expect-overflow");
        var evidence = new JsonObject { ["passed"] = false, ["server"] = url, ["startedAt"] = DateTimeOffset.UtcNow.ToString("O") }; var errors = new List<string>(); var chats = new List<string>();
        await using var client = new TonariumClient(new ClientState(), false);
        client.State.Changed += () => { if (client.State.LastError is { } e && !errors.Contains(e)) { errors.Add(e); Console.WriteLine("sync error: " + e); if (e.Contains("latest state", StringComparison.Ordinal)) evidence["overloadDispatch"] = JsonSerializer.SerializeToNode(client.DispatchDiagnostics); } };
        client.MessageReceived += m => { if (m["t"]?.ToString() == "chat" && m["m"]?["text"]?.ToString() is { } text) chats.Add(text); };
        var start = Stopwatch.StartNew();
        Console.WriteLine("phase connect");
        await client.ConnectAsync(url, "Sync receive probe " + Guid.NewGuid().ToString("N")[..8]);
        Console.WriteLine("phase join"); await client.JoinAsync("sync-load");
        await Until(() => client.State.SyncStatus == "connected", "initial blob snapshot");
        evidence["initialSnapshotMs"] = start.Elapsed.TotalMilliseconds;
        evidence["snapshotStrokeCount"] = client.State.Items["large-canvas"]?["strokes"]?.AsArray().Count;
        var psi = new ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        psi.ArgumentList.Add("--import"); psi.ArgumentList.Add("tsx"); psi.ArgumentList.Add("native/Tonarium.SyncSmoke/peer.ts"); psi.ArgumentList.Add(args.ElementAtOrDefault(2)?.StartsWith("http") == true ? args[2] : url);
        using var peer = Process.Start(psi)!; var stderr = peer.StandardError.ReadToEndAsync();
        try
        {
            Console.WriteLine("phase peer ready");
            var ready = JsonNode.Parse((await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45)))!)!;
            var peerId = ready["id"]!.ToString();
            await Until(() => client.State.Avatars.ContainsKey(peerId), "sender initial position");
            // Network generation lives in a separate process; blocking this UI cannot slow the sender.
            var blocked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Dispatcher.UIThread.Post(() => { blocked.SetResult(); Thread.Sleep(2200); });
            await blocked.Task;
            await peer.StandardInput.WriteLineAsync("burst"); await peer.StandardInput.FlushAsync();
            Console.WriteLine("phase burst");
            var done = await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
            await Task.Delay(600);
            evidence["burst"] = JsonNode.Parse(done!);
            evidence["queue"] = JsonSerializer.SerializeToNode(client.EventQueueDiagnostics);
            evidence["dispatch"] = JsonSerializer.SerializeToNode(client.DispatchDiagnostics);
            evidence["maxPacketWaitMs"] = client.MaxPacketWaitMs;
            evidence["maxBlobWaitMs"] = client.MaxBlobWaitMs;
            evidence["maxUiQueueWaitMs"] = client.MaxUiQueueWaitMs;
            evidence["maxUiApplyMs"] = client.MaxUiApplyMs;
            evidence["maxDecodeMs"] = client.MaxPacketDecodeMs;
            evidence["errors"] = JsonSerializer.SerializeToNode(errors.ToArray());
            if (baseline)
            {
                await Until(() => errors.Any(e => e.Contains("queue overflow", StringComparison.OrdinalIgnoreCase)), "baseline queue overflow");
                evidence["reproducedOverflow"] = true;
            }
            else
            {
                Console.WriteLine("phase verify burst");
                await Until(() => chats.Count(x => x.StartsWith("load-")) == 12 && client.State.Items["load-note"]?["text"]?.ToString() == "edit-11", "all reliable messages and operations");
                await Until(() => client.State.Avatars[peerId]?["x"]?.ToString() == "1.49", "final coalesced position");
                var actual = chats.Where(x => x.StartsWith("load-")).ToArray();
                if (!actual.SequenceEqual(Enumerable.Range(0,12).Select(i => "load-" + i))) throw new Exception("Reliable chat order/duplicates mismatch");
                if (errors.Count > 0) throw new Exception("Unexpected sync errors: " + string.Join(";", errors));
                evidence["reliableOrder"] = JsonSerializer.SerializeToNode(actual);
                evidence["finalPosition"] = client.State.Avatars[peerId]!.DeepClone();
                // Large incoming blob remains in the ordered stream while positions are drained.
                await peer.StandardInput.WriteLineAsync("blob"); await peer.StandardInput.FlushAsync();
                await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
                await peer.StandardInput.WriteLineAsync("positions"); await peer.StandardInput.FlushAsync();
                await Until(() => client.State.Items["load-note"]?["text"]?.ToString() == "after-blob", "delta after large blob");
                await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
                await Until(() => client.State.Chats.OfType<JsonObject>().Any(m => m["text"]?.ToString() == "large-blob" && m["image"]?.ToString().Length == 1500022), "large blob payload intact");
                // Rejoin while an independent sender publishes positions throughout the large snapshot.
                await client.LeaveAsync();
                var rejoin = client.JoinAsync("sync-load");
                await peer.StandardInput.WriteLineAsync("positions"); await peer.StandardInput.FlushAsync();
                await rejoin;
                await Until(() => client.State.SyncStatus == "connected" && client.State.Items["load-note"]?["text"]?.ToString() == "after-blob", "rejoin blob snapshot parity");
                await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
                evidence["blobDispatch"] = JsonSerializer.SerializeToNode(client.DispatchDiagnostics);
                evidence["blobQueue"] = JsonSerializer.SerializeToNode(client.EventQueueDiagnostics);
                evidence["maxBlobWaitMsAfterRejoin"] = client.MaxBlobWaitMs;
                if (client.DispatchDiagnostics?.PositionsWhileBlobPending == 0) throw new Exception("Probe did not overlap positions with snapshot blob");
                if (!client.State.Chats.OfType<JsonObject>().Any(m => m["text"]?.ToString() == "large-blob" && m["image"]?.ToString().Length == 1500022)) throw new Exception("Blob snapshot payload mismatch");
                if (args.Contains("--drop-sync"))
                {
                    var errorCount = errors.Count;
                    using var http = new HttpClient();
                    await http.GetStringAsync(url + "/__drop-sync");
                    await Until(() => errors.Count > errorCount, "real transport loss observed");
                    await Until(() => client.State.SyncStatus == "connected" && client.State.LastError is null, "automatic reconnect after transport loss");
                    if (client.State.Items["load-note"]?["text"]?.ToString() != "after-blob") throw new Exception("Reconnect snapshot lost final operation");
                    evidence["automaticReconnect"] = true;
                }
                if (args.Contains("--saturate"))
                {
                    var blockedLimit = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    Dispatcher.UIThread.Post(() => { blockedLimit.SetResult(); Thread.Sleep(8000); });
                    await blockedLimit.Task;
                    await peer.StandardInput.WriteLineAsync("saturate"); await peer.StandardInput.FlushAsync();
                    await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
                    await Until(() => errors.Any(e => e.Contains("latest state", StringComparison.Ordinal)), "bounded overload explicitly reported");
                    await Until(() => client.State.SyncStatus == "connected" && client.State.Items["load-note"]?["text"]?.ToString() == "limit-299", "overload recovers authoritative final state");
                    evidence["boundedOverloadRecovered"] = true;
                }
                // Invalidate a generation while its UI apply is queued, then enter another room.
                var stalled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                Dispatcher.UIThread.Post(() => { stalled.SetResult(); Thread.Sleep(1600); });
                await stalled.Task; await peer.StandardInput.WriteLineAsync("burst"); await peer.StandardInput.FlushAsync();
                await Task.Delay(250);
                Console.WriteLine("phase leave"); await client.LeaveAsync(); await client.JoinAsync("sync-other");
                await Until(() => client.State.SyncStatus == "connected", "new generation connected");
                await peer.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
                await Task.Delay(500);
                if (client.State.Chats.Any(m => m?["text"]?.ToString().StartsWith("load-") == true) || client.State.Items.ContainsKey("large-canvas") || client.State.Avatars.ContainsKey(peerId)) throw new Exception("Stale generation leaked into new room");
                evidence["generationIsolation"] = true;
                // Cancel during an accepted blob, not just while an ordinary UI callback waits.
                await client.JoinAsync("sync-load");
                await Until(() => client.DispatchDiagnostics is { Received: > 0 } && client.State.SyncStatus != "connected", "snapshot blob started before cancellation");
                var cancelledAt = Stopwatch.StartNew();
                await client.LeaveAsync(); await client.JoinAsync("sync-other");
                await Until(() => client.State.SyncStatus == "connected", "join after blob cancellation");
                if (client.State.Items.ContainsKey("large-canvas")) throw new Exception("Cancelled blob crossed generation");
                evidence["blobCancellationAndRejoinMs"] = cancelledAt.Elapsed.TotalMilliseconds;
                evidence["errorsAfterReconnect"] = JsonSerializer.SerializeToNode(errors.ToArray());
                evidence["passed"] = true;
            }
        }
        finally
        {
            if (!peer.HasExited) peer.Kill(true);
            await peer.WaitForExitAsync();
            evidence["peerErrors"] = await stderr;
            evidence["finishedAt"] = DateTimeOffset.UtcNow.ToString("O");
            evidence["finalStatus"] = client.State.SyncStatus;
            evidence["finalError"] = client.State.LastError;
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
            await File.WriteAllTextAsync(output, evidence.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        Console.WriteLine("PASS sync receive probe: " + output);
    }
    private static async Task Until(Func<bool> test, string label)
    {
        var end = DateTime.UtcNow.AddSeconds(45);
        while (DateTime.UtcNow < end) { if (await Dispatcher.UIThread.InvokeAsync(test)) return; await Task.Delay(50); }
        throw new TimeoutException(label);
    }
}
