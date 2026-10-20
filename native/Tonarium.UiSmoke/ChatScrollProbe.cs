using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.VisualTree;
using SkiaSharp;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Views;

internal static class ChatScrollProbe
{
    internal static async Task Run(string output, Action<string> pass)
    {
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "preferences"));
        NativeSettings.SetBool("room.rightFolded", false);
        var window = new MainWindow();
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        using var bitmap = new SKBitmap(640, 360); bitmap.Erase(SKColors.CornflowerBlue);
        using var png = bitmap.Encode(SKEncodedImageFormat.Png, 100); var bytes = png.ToArray();
        var serve = Task.Run(async () =>
        {
            using var request = await listener.AcceptTcpClientAsync();
            await using var stream = request.GetStream();
            using var reader = new StreamReader(stream, leaveOpen: true);
            while (await reader.ReadLineAsync() is { Length: > 0 }) { }
            await Task.Delay(700);
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n"));
            await stream.WriteAsync(bytes);
        });
        try
        {
            window.Show(); Call(window, "LoadDemo");
            var client = Field<TonariumClient>(window, "client");
            client.State.SessionId = "lounge";
            typeof(MainWindow).GetField("previousSession", BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(window, "lounge");
            client.State.Chats = new JsonArray(Enumerable.Range(0, 45).Select(i => (JsonNode?)new JsonObject
            { ["id"] = "line-" + i, ["text"] = $"ログ {i}：末尾までスクロールできるか確認", ["from"] = "demo1", ["fromName"] = "あおい", ["at"] = i }).ToArray());
            Call(window, "Refresh"); await Tick();
            var room = Field<RoomView>(window, "room"); var scroll = Field<ScrollViewer>(room, "_logScroll"); var logs = Field<StackPanel>(room, "_logs");
            scroll.ScrollToHome(); await Tick();
            var point = scroll.TranslatePoint(new Point(100, 100), window)!.Value;
            for (var i = 0; i < 30; i++) window.MouseWheel(point, new Vector(0, -6), RawInputModifiers.None);
            await Tick(); RequireBottom("wheel reaches the last message"); pass("Mouse wheel reaches the last message in a long chat");

            client.State.Chats.Add(new JsonObject { ["id"] = "image", ["text"] = "遅れて読み込む最後の画像", ["from"] = "demo1", ["fromName"] = "あおい", ["media"] = new JsonObject { ["kind"] = "image", ["url"] = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/image.png" } });
            Call(window, "Refresh"); await Tick(); await serve; await Tick(); await Tick();
            RequireBottom("image finishes loading at the bottom"); pass("Late image loading keeps the chat at the bottom");
            window.Height = 660; await Tick(); RequireBottom("resize preserves the bottom"); pass("Shrinking the window keeps the last message above the composer");

            scroll.Offset = new Vector(0, 100); await Tick(); var oldOffset = scroll.Offset.Y;
            client.State.Chats.Add(new JsonObject { ["id"] = "new-line", ["text"] = "新着メッセージ", ["from"] = "demo1", ["fromName"] = "あおい" });
            Call(window, "Refresh"); await Tick();
            if (Math.Abs(scroll.Offset.Y - oldOffset) > 2) throw new Exception("Reading older chat was interrupted by a new message");
            pass("Reading older messages preserves the scroll position");
            scroll.ScrollToEnd(); await Tick();
            var input = Field<TextBox>(room, "_input"); input.Text = string.Concat(Enumerable.Repeat("長いメッセージの入力です。", 18)); input.Focus(); await Tick();
            RequireBottom("multiline composer preserves the bottom");
            var bars = new[] { scroll }.Concat(input.GetVisualDescendants().OfType<ScrollViewer>()).SelectMany(v => v.GetVisualDescendants().OfType<ScrollBar>()).Where(b => b.IsVisible).ToArray();
            if (bars.Length > 0) throw new Exception("Visible chat/input scrollbars: " + bars.Length);
            pass("Chat and multiline composer hide scrollbars while retaining scrolling");
            using var frame = window.CaptureRenderedFrame(); frame!.Save(Path.Combine(output, "chat-scroll.png"));

            void RequireBottom(string label)
            {
                var bottom = logs.Children.Last().TranslatePoint(new Point(0, logs.Children.Last().Bounds.Height), scroll)!.Value.Y;
                var gap = scroll.Extent.Height - scroll.Viewport.Height - scroll.Offset.Y;
                Console.WriteLine($"{label}: gap={gap:F1}, last={bottom:F1}, viewport={scroll.Viewport.Height:F1}, bounds={scroll.Bounds.Height:F1}");
                if (gap > 2 || bottom > scroll.Bounds.Height + 1) throw new Exception(label + ": last chat is clipped");
            }
        }
        finally { window.Close(); listener.Stop(); }
    }
    static T Field<T>(object obj, string name) => (T)obj.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(obj)!;
    static void Call(object obj, string name) => obj.GetType().GetMethod(name, BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(obj, null);
    static async Task Tick() { await Task.Delay(180); AvaloniaHeadlessPlatform.ForceRenderTimerTick(3); }
}
