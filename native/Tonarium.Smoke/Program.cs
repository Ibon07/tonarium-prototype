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
        var task = Task.Run(() => RunAsync(args.FirstOrDefault() ?? "http://localhost:3001"));
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
            await first.SendAsync(new { t = "itemAction", id = canvas, action = new { a = "strokeStart", id = unique, color = "#111111", size = 4, x = 10, y = 20 } });
            await first.SendAsync(new { t = "itemAction", id = canvas, action = new { a = "strokeAdd", id = unique, pts = new[] { 30, 40, 50, 60 } } });
            await Until(() => second.State.Items[canvas]?["strokes"] is JsonArray { Count: > 0 } strokes && strokes[0]?["pts"] is JsonArray pts && pts.Count == 6, "canvas stroke");
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
