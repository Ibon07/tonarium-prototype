using Avalonia;
using Avalonia.Threading;
using System.Diagnostics;
using System.Text.Json.Nodes;
using Tonarium.Desktop.Core;

internal sealed class SmokeApp : Application { }

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        AppBuilder.Configure<SmokeApp>().UsePlatformDetect().SetupWithoutStarting();
        using var quit = new CancellationTokenSource();
        var task = Task.Run(() => args.Contains("--canvas-latency")
            ? CanvasLatencyProbe.RunAsync(args[0], args.ElementAtOrDefault(2) ?? args[0], args.ElementAtOrDefault(3) ?? "native/artifacts/canvas-latency.json")
            : args.Contains("--canvas-roundtrip")
            ? RunCanvasRoundtripAsync(args.FirstOrDefault(x => x.StartsWith("http", StringComparison.Ordinal)) ?? "http://localhost:3015",
                args.ElementAtOrDefault(Array.IndexOf(args, "--canvas-roundtrip") + 1) ?? "native/artifacts/unity-canvas-core/result.json")
            : RunAsync(args.FirstOrDefault() ?? "http://localhost:3001"));
        _ = task.ContinueWith(_ => Dispatcher.UIThread.Post(quit.Cancel));
        Dispatcher.UIThread.MainLoop(quit.Token);
        try { task.GetAwaiter().GetResult(); return 0; }
        catch (Exception ex) { Console.Error.WriteLine("FAIL " + ex.Message); return 1; }
    }

    private static async Task RunAsync(string url)
    {
        await using var first = new TonariumClient(new ClientState(), persistSettings: false);
        await using var second = new TonariumClient(new ClientState(), persistSettings: false);
        var unique = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        string? sid = null;
        try
        {
            await first.ConnectAsync(url, "Native Smoke A " + unique);
            await second.ConnectAsync(url, "Native Smoke B " + unique);
            await Until(() => first.State.Users.Count >= 2 && first.State.Snapshot.Count > 0, "home snapshot and users");
            Console.WriteLine("PASS home snapshots / two native clients");
            await first.SendAsync(new { t = "sessionCreate", name = "Native smoke " + unique, topic = "Temporary normal-flow verification", world = "room", visibility = "public" });
            await Until(() => first.State.Sessions.OfType<JsonObject>().Any(s => s["name"]?.ToString() == "Native smoke " + unique), "session create");
            sid = first.State.Sessions.OfType<JsonObject>().First(s => s["name"]?.ToString() == "Native smoke " + unique)["id"]!.ToString();
            await first.JoinAsync(sid); await second.JoinAsync(sid);
            await Until(() => first.State.SyncStatus == "connected" && second.State.SyncStatus == "connected", "encrypted KokoSync snapshots", () => first.State.LastError + " / " + second.State.LastError);
            Console.WriteLine("PASS KokoSync authenticated native handshake / encrypted snapshots");
            await first.SendAsync(new { t = "chat", text = "Native interoperability " + unique, scope = "all" });
            await Until(() => second.State.Chats.OfType<JsonObject>().Any(m => m["text"]?.ToString() == "Native interoperability " + unique), "room chat");
            await first.SendAsync(new { t = "mode", mode = "3d" });
            await first.SendAsync(new { t = "avatar", s = new { x = 2.5, z = 3.5, ry = 0.5 } });
            await Until(() => second.State.Avatars[first.State.SelfId]?["x"]?.ToString() == "2.5", "avatar position", () => second.State.Avatars.ToJsonString() + "; " + first.State.LastError + "; " + second.State.LastError);
            Console.WriteLine("PASS room chat / 3D mode / avatar latest");
            await first.SendAsync(new { t = "itemCreate", kind = "note", x = 1, z = 1, ry = 0, text = "Native note" });
            await Until(() => second.State.Items.Any(i => i.Value?["kind"]?.ToString() == "note"), "note create");
            var note = second.State.Items.First(i => i.Value?["kind"]?.ToString() == "note").Key;
            await second.SendAsync(new { t = "itemAction", id = note, action = new { a = "noteEdit", text = "Edited from second native" } });
            await Until(() => first.State.Items[note]?["text"]?.ToString() == "Edited from second native", "note edit");
            await first.SendAsync(new { t = "itemCreate", kind = "canvas", x = 2, z = 1, ry = 0 });
            await Until(() => second.State.Items.Any(i => i.Value?["kind"]?.ToString() == "canvas"), "canvas create");
            var canvas = second.State.Items.First(i => i.Value?["kind"]?.ToString() == "canvas").Key;
            await VerifyCanvasRoundtrip(first, second, canvas, sid, unique, new JsonArray());
            Console.WriteLine("PASS shared note edits / canvas deltas");
            await first.SendAsync(new { t = "itemCreate", kind = "dice", x = 3, z = 1, ry = 0 });
            await Until(() => second.State.Items.Any(i => i.Value?["kind"]?.ToString() == "dice"), "dice create");
            var dice = second.State.Items.First(i => i.Value?["kind"]?.ToString() == "dice").Key;
            await first.SendAsync(new { t = "itemAction", id = dice, action = new { a = "diceRoll", sides = 6, count = 2, secret = false } });
            await Until(() => second.State.Items[dice]?["roll"] is JsonObject, "dice roll");
            await second.SendAsync(new { t = "broadcast", on = true });
            await Until(() => first.State.Broadcast, "broadcast");
            await first.SendAsync(new { t = "world", world = "cafe" });
            await Until(() => second.State.World == "cafe", "world transition");
            Console.WriteLine("PASS dice roll / broadcast / world transition");
            await first.SendAsync(new { t = "friendRequest", to = second.State.SelfId });
            await Until(() => second.State.Notifications.OfType<JsonObject>().Any(n => n["t"]?.ToString() == "friendRequest"), "friend request");
            await second.SendAsync(new { t = "friendAccept", to = first.State.SelfId });
            await Until(() => first.State.Friends.Any(n => n?.ToString() == second.State.Name), "friend accept");
            var conv = "dm:" + string.Join('\0', new[] { first.State.Name, second.State.Name }.Order(StringComparer.Ordinal));
            await first.SendAsync(new { t = "msg", conv, text = "Native direct message " + unique });
            await Until(() => second.State.Conversations[conv] is JsonArray messages && messages.Count > 0, "direct message");
            await second.SendAsync(new { t = "read", conv, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            await Until(() => second.State.Reads.ContainsKey(conv), "read receipt");
            Console.WriteLine("PASS friendship / direct message / read receipt");
            var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
            var image = "data:image/png;base64," + Convert.ToBase64String(await File.ReadAllBytesAsync(Path.Combine(root, "client/public/brand/logo.png")));
            await first.SendAsync(new { t = "chat", text = "Native large image " + unique, image, scope = "all" });
            await Until(() => second.State.Chats.OfType<JsonObject>().Any(m => m["image"]?.ToString() == image), "large encrypted blob");
            Console.WriteLine("PASS large image via encrypted KokoSync blob");
            var info = new ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var arg in new[] { "node_modules/tsx/dist/cli.mjs", "native/Tonarium.Smoke/web-peer.ts", url, sid, unique }) info.ArgumentList.Add(arg);
            using var web = Process.Start(info)!;
            var output = web.StandardOutput.ReadToEndAsync(); var error = web.StandardError.ReadToEndAsync();
            await Until(() => first.State.Chats.OfType<JsonObject>().Any(m => m["text"]?.ToString() == "Web SDK hello " + unique), "web SDK chat");
            await Until(() => first.State.Avatars.Any(a => a.Value?["x"]?.ToString() == "4.25"), "web SDK avatar");
            await first.SendAsync(new { t = "chat", text = "Native SDK acknowledgement " + unique, scope = "all" });
            await web.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(35));
            if (web.ExitCode != 0) throw new Exception("Web SDK peer: " + await error);
            Console.Write(await output);
            Console.WriteLine("PASS ALL native happy-path checks");
        }
        finally
        {
            await second.LeaveAsync(); await first.LeaveAsync();
            if (sid is not null) await first.SendAsync(new { t = "sessionDelete", id = sid });
        }
    }

    private static async Task RunCanvasRoundtripAsync(string url, string output)
    {
        var evidence = new JsonArray();
        var result = new JsonObject { ["passed"] = false, ["server"] = url, ["checks"] = evidence, ["startedAt"] = DateTimeOffset.UtcNow.ToString("O") };
        await using var first = new TonariumClient(new ClientState(), persistSettings: false);
        await using var second = new TonariumClient(new ClientState(), persistSettings: false);
        string? sid = null;
        try
        {
            var unique = Guid.NewGuid().ToString("N")[..10];
            await first.ConnectAsync(url, "Canvas sender " + unique);
            await second.ConnectAsync(url, "Canvas peer " + unique);
            await first.SendAsync(new { t = "sessionCreate", name = "Canvas roundtrip " + unique, topic = "Native sender and receiver consistency", world = "room", visibility = "public" });
            await Until(() => first.State.Sessions.OfType<JsonObject>().Any(s => s["name"]?.ToString() == "Canvas roundtrip " + unique), "canvas test session");
            sid = first.State.Sessions.OfType<JsonObject>().First(s => s["name"]?.ToString() == "Canvas roundtrip " + unique)["id"]!.ToString();
            result["session"] = sid;
            await first.JoinAsync(sid); await second.JoinAsync(sid);
            await Until(() => first.State.SyncStatus == "connected" && second.State.SyncStatus == "connected", "canvas peers connected");
            await first.SendAsync(new { t = "itemCreate", kind = "canvas", x = 2, z = 1, ry = 0 });
            await Until(() => first.State.Items.Any(i => i.Value?["kind"]?.ToString() == "canvas") && second.State.Items.Any(i => i.Value?["kind"]?.ToString() == "canvas"), "canvas visible to both peers");
            var canvas = first.State.Items.First(i => i.Value?["kind"]?.ToString() == "canvas").Key;
            result["canvas"] = canvas;
            await VerifyCanvasRoundtrip(first, second, canvas, sid, unique, evidence);
            result["passed"] = true;
        }
        catch (Exception ex) { result["error"] = ex.Message; throw; }
        finally
        {
            result["finishedAt"] = DateTimeOffset.UtcNow.ToString("O");
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
            await File.WriteAllTextAsync(output, result.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            if (second.State.SessionId is not null) await second.LeaveAsync();
            if (first.State.SessionId is not null) await first.LeaveAsync();
            if (sid is not null && first.State.Connected) await first.SendAsync(new { t = "sessionDelete", id = sid });
        }
        Console.WriteLine("PASS canvas sender/receiver roundtrip; evidence: " + Path.GetFullPath(output));
    }

    private static async Task VerifyCanvasRoundtrip(TonariumClient first, TonariumClient second, string canvas, string sid, string unique, JsonArray evidence)
    {
        var firstEvents = new List<string>(); var secondEvents = new List<string>();
        void Capture(JsonObject message, List<string> events)
        {
            if (message["t"]?.ToString() == "itemAction" && message["id"]?.ToString() == canvas)
                events.Add(message["action"]?["a"]?.ToString() ?? "");
        }
        void OnFirst(JsonObject message) => Capture(message, firstEvents);
        void OnSecond(JsonObject message) => Capture(message, secondEvents);
        first.MessageReceived += OnFirst; second.MessageReceived += OnSecond;
        try
        {
            await Draw(first, second, "forward", "#111111", new[] { 10, 20, 30, 40, 50, 60, 70, 80 });
            await first.SendRoomAsync(new { t = "itemAction", id = canvas, action = new { a = "canvasClear" } });
            await Until(() => Empty(first) && Empty(second), "forward clear reflected on sender and receiver");
            Record("forward-clear", first);
            await Draw(second, first, "reverse", "#2468ac", new[] { 310, 220, 330, 240, 350, 260, 370, 280 });

            await second.LeaveAsync(); await second.JoinAsync(sid);
            await Until(() => second.State.SyncStatus == "connected" && HasExpected(second, "reverse", second.State.SelfId,
                new[] { 310, 220, 330, 240, 350, 260, 370, 280 }), "sender rejoin snapshot preserves exact stroke");
            await Until(() => SameStrokes(first, second), "sender rejoin snapshot equals live receiver state");
            Record("reverse-sender-rejoin-snapshot", second);

            await first.LeaveAsync(); await first.JoinAsync(sid);
            await Until(() => first.State.SyncStatus == "connected" && SameStrokes(first, second), "receiver rejoin snapshot equals live sender state");
            Record("reverse-receiver-rejoin-snapshot", first);
            await second.SendRoomAsync(new { t = "itemAction", id = canvas, action = new { a = "canvasClear" } });
            await Until(() => Empty(first) && Empty(second), "reverse clear reflected on sender and receiver");
            Record("reverse-clear", second);
            await first.LeaveAsync(); await first.JoinAsync(sid);
            await Until(() => first.State.SyncStatus == "connected" && Empty(first), "cleared canvas remains empty in rejoin snapshot");
            Record("clear-rejoin-snapshot", first);

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                foreach (var events in new[] { firstEvents, secondEvents })
                    if (events.Count(a => a == "strokeStart") != 2 || events.Count(a => a == "strokeAdd") != 4 || events.Count(a => a == "canvasClear") != 2)
                        throw new InvalidOperationException("Canvas MessageReceived deltas must each fire exactly once per peer.");
                evidence.Add(new JsonObject { ["check"] = "unity-bridge-message-events-once", ["senderEvents"] = new JsonArray(firstEvents.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()), ["receiverEvents"] = new JsonArray(secondEvents.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()) });
            });
            Console.WriteLine("PASS canvas exact points / local bridge events / clear / reverse sender / rejoin snapshots");
        }
        finally { first.MessageReceived -= OnFirst; second.MessageReceived -= OnSecond; }

        async Task Draw(TonariumClient sender, TonariumClient receiver, string suffix, string color, int[] points)
        {
            var stroke = unique + "-" + suffix;
            await sender.SendRoomAsync(new { t = "itemAction", id = canvas, action = new { a = "strokeStart", id = stroke, color, size = 4, x = points[0], y = points[1] } });
            await Until(() => HasExpected(sender, suffix, sender.State.SelfId, points[..2]) && HasExpected(receiver, suffix, sender.State.SelfId, points[..2]), suffix + " start on sender and receiver");
            await sender.SendRoomAsync(new { t = "itemAction", id = canvas, action = new { a = "strokeAdd", id = stroke, pts = points[2..6] } });
            await Until(() => HasExpected(sender, suffix, sender.State.SelfId, points[..6]) && HasExpected(receiver, suffix, sender.State.SelfId, points[..6]), suffix + " first point batch");
            await sender.SendRoomAsync(new { t = "itemAction", id = canvas, action = new { a = "strokeAdd", id = stroke, pts = points[6..] } });
            await Until(() => HasExpected(sender, suffix, sender.State.SelfId, points) && HasExpected(receiver, suffix, sender.State.SelfId, points), suffix + " full exact point sequence");
            await Until(() => SameStrokes(sender, receiver), suffix + " sender and receiver identical stroke metadata");
            Record(suffix + "-exact-points", sender);
        }
        bool HasExpected(TonariumClient client, string suffix, string author, int[] expected)
        {
            if (client.State.Items[canvas]?["strokes"] is not JsonArray { Count: 1 } strokes || strokes[0] is not JsonObject stroke ||
                stroke["id"]?.ToString() != unique + "-" + suffix || stroke["by"]?.ToString() != author || stroke["pts"] is not JsonArray pts || pts.Count != expected.Length) return false;
            return pts.Select(x => Convert.ToDouble(x!.ToString(), System.Globalization.CultureInfo.InvariantCulture)).SequenceEqual(expected.Select(x => (double)x));
        }
        bool Empty(TonariumClient client) => client.State.Items[canvas]?["strokes"] is JsonArray { Count: 0 };
        bool SameStrokes(TonariumClient a, TonariumClient b) => a.State.Items[canvas]?["strokes"] is JsonArray aa && b.State.Items[canvas]?["strokes"] is JsonArray bb && JsonNode.DeepEquals(aa, bb);
        void Record(string check, TonariumClient source) => evidence.Add(new JsonObject
        {
            ["check"] = check, ["source"] = source.State.SelfId,
            ["firstPeerStrokes"] = first.State.Items[canvas]?["strokes"]?.DeepClone(),
            ["secondPeerStrokes"] = second.State.Items[canvas]?["strokes"]?.DeepClone()
        });
    }

    private static async Task Until(Func<bool> condition, string label, Func<string?>? details = null)
    {
        var end = DateTime.UtcNow.AddSeconds(50);
        while (DateTime.UtcNow < end)
        {
            if (await Dispatcher.UIThread.InvokeAsync(condition)) return;
            await Task.Delay(50);
        }
        throw new TimeoutException(label + ": " + details?.Invoke());
    }
}
