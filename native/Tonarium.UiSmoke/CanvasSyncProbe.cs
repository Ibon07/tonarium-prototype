using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Views;

internal static class CanvasSyncProbe
{
    internal static async Task Run(string senderUrl, string receiverUrl, string output, Action<string> pass)
    {
        await using var sender = new TonariumClient(persistSettings: false);
        await using var receiver = new TonariumClient(persistSettings: false);
        var name = "Canvas batch " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string? session = null;
        Window? window = null;
        try
        {
            await sender.ConnectAsync(senderUrl, name + " A");
            await receiver.ConnectAsync(receiverUrl, name + " B");
            await sender.SendAsync(new { t = "sessionCreate", name, world = "room", visibility = "public" });
            await Until(() => sender.State.Sessions.Any(s => J.Text(s, "name") == name));
            session = J.Text(sender.State.Sessions.First(s => J.Text(s, "name") == name), "id");
            await sender.JoinAsync(session); await receiver.JoinAsync(session);
            await Until(() => sender.State.SyncStatus == "connected" && receiver.State.SyncStatus == "connected");
            await sender.SendRoomAsync(new { t = "itemCreate", kind = "canvas", x = 1, z = 1, ry = 0 });
            await Until(() => receiver.State.Items.Any(i => J.Text(i.Value, "kind") == "canvas") && sender.State.Items.Any(i => J.Text(i.Value, "kind") == "canvas"));
            string item = receiver.State.Items.First(i => J.Text(i.Value, "kind") == "canvas").Key;
            var sent = new List<JsonObject>(); var tasks = new List<Task>();
            Action<object> send = action =>
            {
                var value = JsonSerializer.SerializeToNode(action)!.AsObject(); sent.Add(value);
                tasks.Add(sender.SendRoomAsync(new { t = "itemAction", id = item, action }));
            };
            var type = typeof(MainWindow).Assembly.GetType("Tonarium.Desktop.Views.SharedDrawingCanvas")!;
            var canvas = (Control)Activator.CreateInstance(type, new Func<JsonObject?>(() => sender.State.Items[item] as JsonObject), send)!;
            window = new Window { Width = 620, Height = 450, Content = canvas };
            window.Show(); await Task.Delay(100); AvaloniaHeadlessPlatform.ForceRenderTimerTick(2);
            var origin = canvas.TranslatePoint(default, window)!.Value;
            var clock = Stopwatch.StartNew(); long completed = 0;
            string stroke = "";
            JsonArray? ReceivedPoints() => receiver.State.Items[item]?["strokes"]?.AsArray().FirstOrDefault(s => J.Text(s, "id") == stroke)?["pts"] as JsonArray;
            void Changed() { if (completed == 0 && ReceivedPoints()?.Count == 208) completed = clock.ElapsedTicks; }
            receiver.State.Changed += Changed;
            try
            {
                Point Position(int i) => origin + new Vector(20 + i * 4, 30 + i * 7 % 250);
                var expected = new List<double> { 20, 30 };
                window.MouseDown(Position(0), MouseButton.Left);
                stroke = J.Text(sent[0], "id");
                for (int i = 1; i <= 103; i++)
                {
                    window.MouseMove(Position(i), RawInputModifiers.LeftMouseButton);
                    expected.Add(20 + i * 4); expected.Add(30 + i * 7 % 250);
                    await Task.Delay(10);
                }
                window.MouseUp(Position(103), MouseButton.Left);
                double inputMs = clock.Elapsed.TotalMilliseconds;
                var additions = sent.Where(x => J.Text(x, "a") == "strokeAdd").ToArray();
                var transmitted = new List<double> { 20, 30 };
                transmitted.AddRange(additions.SelectMany(x => x["pts"]!.AsArray()).Select(n => double.Parse(n!.ToString(), System.Globalization.CultureInfo.InvariantCulture)));
                if (!transmitted.SequenceEqual(expected)) throw new Exception("Pointer release did not flush every point in order.");
                if (additions.Length >= 35 || additions.Length < 2) throw new Exception("Canvas did not batch high-frequency pointer events.");
                pass("Native pointer input batches points and release flushes the complete ordered line");
                using (var frame = window.CaptureRenderedFrame()) frame!.Save(Path.Combine(output, "canvas-local.png"));
                await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(15));
                await Until(() => ReceivedPoints()?.Count == expected.Count);
                var received = ReceivedPoints()!.Select(n => double.Parse(n!.ToString(), System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                if (!received.SequenceEqual(expected)) throw new Exception("Receiver lost or reordered canvas points.");
                pass("Real receiver gets every native canvas point in order");
                int beforeClick = sent.Count;
                window.MouseDown(Position(0), MouseButton.Left); window.MouseUp(Position(0), MouseButton.Left);
                if (sent.Count != beforeClick + 1 || J.Text(sent[^1], "a") != "strokeStart") throw new Exception("Single click must remain a single dot.");
                await Task.WhenAll(tasks);
                pass("Single-dot drawing remains intact without empty strokeAdd messages");
                int beforeShortStroke = sent.Count;
                window.MouseDown(Position(0), MouseButton.Left);
                window.MouseMove(Position(1), RawInputModifiers.LeftMouseButton);
                if (sent.Count != beforeShortStroke + 1) throw new Exception("Short movement should remain buffered until release.");
                window.MouseUp(Position(1), MouseButton.Left);
                if (sent.Count != beforeShortStroke + 2 || sent[^1]["pts"]?.AsArray().Count != 2)
                    throw new Exception("Release must immediately flush the final buffered point.");
                await Task.WhenAll(tasks);
                pass("Releasing within 50 ms immediately sends the final buffered point");
                double receiverMs = (double)completed / Stopwatch.Frequency * 1000;
                await File.WriteAllTextAsync(Path.Combine(output, "canvas-sync.json"), JsonSerializer.Serialize(new
                {
                    passed = true, inputPoints = 104, strokeAddMessages = additions.Length, inputMs, receiverMs,
                    lagAfterInputMs = Math.Max(0, receiverMs - inputMs), allPointsInOrder = true,
                    senderUrl, receiverUrl, note = "Real SharedDrawingCanvas pointer events and two native clients; sender uses the optional latency proxy."
                }, new JsonSerializerOptions { WriteIndented = true }));
            }
            finally { receiver.State.Changed -= Changed; }
        }
        finally
        {
            window?.Close();
            await receiver.LeaveAsync(); await sender.LeaveAsync();
            if (session is not null) await sender.SendAsync(new { t = "sessionDelete", id = session });
        }
    }
    private static async Task Until(Func<bool> condition)
    {
        var timer = Stopwatch.StartNew();
        while (!condition())
        {
            if (timer.Elapsed.TotalSeconds > 20) throw new TimeoutException("Canvas synchronization timed out.");
            await Task.Delay(20);
        }
    }
}
