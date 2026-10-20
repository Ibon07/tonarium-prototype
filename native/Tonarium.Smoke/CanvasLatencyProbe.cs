using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia.Threading;
using Tonarium.Desktop.Core;

internal static class CanvasLatencyProbe
{
    internal static async Task RunAsync(string senderUrl, string receiverUrl, string output)
    {
        await using var sender = new TonariumClient(persistSettings: false);
        await using var receiver = new TonariumClient(persistSettings: false);
        string label = "Canvas latency " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string? session = null;
        var results = new List<object>();
        try
        {
            await sender.ConnectAsync(senderUrl, label + " sender");
            await receiver.ConnectAsync(receiverUrl, label + " receiver");
            await sender.SendAsync(new { t = "sessionCreate", name = label, world = "room", visibility = "public" });
            await Until(() => sender.State.Sessions.Any(s => s?["name"]?.ToString() == label));
            session = await Dispatcher.UIThread.InvokeAsync(() => sender.State.Sessions.First(s => s?["name"]?.ToString() == label)!["id"]!.ToString());
            await sender.JoinAsync(session); await receiver.JoinAsync(session);
            await Until(() => sender.State.SyncStatus == "connected" && receiver.State.SyncStatus == "connected");
            await sender.SendRoomAsync(new { t = "itemCreate", kind = "canvas", x = 1, z = 1, ry = 0 });
            await Until(() => receiver.State.Items.Any(i => i.Value?["kind"]?.ToString() == "canvas"));
            string item = await Dispatcher.UIThread.InvokeAsync(() => receiver.State.Items.First(i => i.Value?["kind"]?.ToString() == "canvas").Key);
            foreach (bool batch in new[] { false, true })
            {
                string stroke = Guid.NewGuid().ToString("N");
                await sender.SendRoomAsync(new { t = "itemAction", id = item, action = new { a = "strokeStart", id = stroke, color = "#111111", size = 3, x = 0, y = 10 } });
                var clock = Stopwatch.StartNew();
                var tasks = new List<Task>();
                var points = new List<int>();
                long receivedAt = 0;
                int received = 0;
                void Changed()
                {
                    var strokes = receiver.State.Items[item]?["strokes"] as JsonArray;
                    int count = (strokes?.FirstOrDefault(s => s?["id"]?.ToString() == stroke)?["pts"] as JsonArray)?.Count / 2 ?? 0;
                    received = count;
                    if (count >= 101 && receivedAt == 0) receivedAt = clock.ElapsedTicks;
                }
                receiver.State.Changed += Changed;
                try
                {
                    for (int i = 1; i <= 100; i++)
                    {
                        points.Add(i * 4); points.Add(10 + i % 50 * 4);
                        if (!batch || i % 5 == 0)
                        {
                            tasks.Add(sender.SendRoomAsync(new { t = "itemAction", id = item, action = new { a = "strokeAdd", id = stroke, pts = points.ToArray() } }));
                            points.Clear();
                        }
                        await Task.Delay(10);
                    }
                    double inputMs = clock.Elapsed.TotalMilliseconds;
                    await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(20));
                    await Until(() => received >= 101);
                    double receiverMs = (double)receivedAt / Stopwatch.Frequency * 1000;
                    results.Add(new { strategy = batch ? "web-style-50ms-batches" : "current-native-one-point-per-message", points = 100, messages = tasks.Count, inputMs, receiverMs, lagAfterInputMs = receiverMs - inputMs, allPointsReceived = received == 101 });
                    Console.WriteLine($"{(batch ? "batched" : "per-point")}: {tasks.Count} messages, input {inputMs:0} ms, receiver finished {receiverMs:0} ms, tail {receiverMs - inputMs:0} ms");
                }
                finally { receiver.State.Changed -= Changed; }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
            await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { senderUrl, receiverUrl, results }, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally
        {
            await receiver.LeaveAsync(); await sender.LeaveAsync();
            if (session is not null) await sender.SendAsync(new { t = "sessionDelete", id = session });
        }
    }
    private static async Task Until(Func<bool> condition)
    {
        var end = Stopwatch.StartNew();
        while (!await Dispatcher.UIThread.InvokeAsync(condition))
        {
            if (end.Elapsed.TotalSeconds > 30) throw new TimeoutException("Canvas latency probe timed out.");
            await Task.Delay(20);
        }
    }
}
