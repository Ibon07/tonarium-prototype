using System.Reflection;
using System.Net.Http.Headers;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Interactivity;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;
using SkiaSharp;

internal static class RoomAvatarProbe
{
    internal static async Task Run(string server, string output, Action<string> pass)
    {
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "room-avatar-preferences"));
        NativeSettings.SetBool("room.facesFolded", false);
        var state = new ClientState { SelfId = "self", Name = "Self", SessionId = "room", ServerUrl = server };
        state.Users = new JsonArray(User("self", 0), User("peer", 1), User("other", 2));
        await using var client = new TonariumClient(state, persistSettings: false);
        await using var media = new NativeMedia(client);
        var window = new Window { Width = 1360, Height = 880 };
        var context = new NativeContext(client, media, window);
        var room = new RoomView(context); window.Content = room;
        var evidence = new List<object>();
        try
        {
            window.Show(); await Tick();
            CaptureRoom("gallery");
            var portraits = Portraits(room);
            if (portraits.Count != 3 || portraits.Values.Any(p => p.FrameCount == 0))
                throw new Exception("Initial room portraits did not render.");
            var detaches = 0;
            foreach (var p in portraits.Values) p.DetachedFromVisualTree += (_, _) => detaches++;
            var peer = portraits["peer"];
            var firstFrame = peer.FrameCount;
            var rows = Field<Dictionary<string, (ContentControl View, string Key)>>(room, "_playerRows").ToDictionary(p => p.Key, p => p.Value.View);
            var rowDetaches = 0; foreach (var row in rows.Values) row.DetachedFromVisualTree += (_, _) => rowDetaches++;

            // The production media speaking flag is independent of presence JSON.
            var speakers = Field<System.Collections.Concurrent.ConcurrentDictionary<string, bool>>(media, "speakers");
            for (var i = 0; i < 12; i++)
            {
                speakers["peer"] = i % 2 == 0; room.Refresh(); Check("speaking-" + i);
                if (Tile(peer).BorderThickness.Left != (i % 2 == 0 ? 3 : 1)) throw new Exception("Speaking border did not track media state.");
            }
            state.Presence["peer"] = new JsonObject { ["micOn"] = true };
            room.Refresh(); Check("microphone update");
            state.Chats.Add(new JsonObject { ["id"] = "chat", ["from"] = "peer", ["text"] = "Hello", ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            room.Refresh(); Check("chat update");
            if (!peer.GetVisualAncestors().OfType<Grid>().First().GetVisualDescendants().OfType<TextBlock>().Any(t => t.IsEffectivelyVisible && t.Text == "Hello")) throw new Exception("Chat bubble did not update.");
            var oldLeft = Canvas.GetLeft(Tile(peer));
            state.Users[1]!["pos"]!["x"] = 2.5;
            state.Users[2]!["pos"]!["x"] = .5;
            room.Refresh(); Check("distance order update");
            if (Canvas.GetLeft(Tile(peer)) == oldLeft || rowDetaches != 0) throw new Exception("Distance order did not move retained tiles/rows correctly.");
            await Tick();
            if (peer.FrameCount <= firstFrame) throw new Exception("Animation stopped after room updates.");
            pass("Room avatar controls and rendered frames survive microphone, chat and distance ordering updates");

            window.Width = 1000; window.Height = 640; await Tick(); Check("window resize");
            room.SetOpenItemCount(1); await Tick(); Check("item opens strip");
            state.Users[1]!["pos"]!["x"] = 8;
            room.Refresh(); await Tick(); Check("mid distance small tile");
            CaptureRoom("strip");
            if (!peer.Small) throw new Exception("Mid-distance strip portrait did not switch to small framing.");
            state.Mode = "3d"; room.Refresh(); await Tick(); Check("3d mode");
            state.Mode = "2d"; room.Refresh(); room.SetOpenItemCount(0); await Tick(); Check("gallery restored");
            if (peer.Small) throw new Exception("Gallery portrait retained small framing.");
            Field<Button>(room, "_faceFold").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            var hiddenFrame = peer.FrameCount; await Tick();
            if (peer.IsEffectivelyVisible || peer.FrameCount != hiddenFrame || detaches != 0) throw new Exception("Folded portrait was detached or still rasterizing.");
            Field<Button>(room, "_foldedFaces").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            await Tick(); Check("unfolded gallery");
            CaptureRoom("resized-gallery");
            pass("Resize, gallery/strip, small framing, 2D/3D and folding retain portrait identity and pixels");

            // Replace the JSON object to ensure click handlers resolve current state, not a construction-time clone.
            var replacement = (JsonObject)state.Users[1]!.DeepClone();
            replacement["name"] = "Renamed peer"; replacement["sharing"] = true; state.Users[1] = replacement;
            room.Refresh(); Check("participant metadata update");
            peer.GetVisualAncestors().OfType<Button>().First().RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            var popup = window.OwnedWindows.Single();
            if (!popup.GetVisualDescendants().OfType<TextBlock>().Any(t => t.Text == "Renamed peer") ||
                !popup.GetVisualDescendants().OfType<Button>().Any(b => Avalonia.Automation.AutomationProperties.GetName(b) == "ライブを見る"))
                throw new Exception("Portrait click used stale participant metadata.");
            popup.Close(); await Tick(); Check("portrait popup closed");
            pass("Portrait actions read current participant name and sharing state");

            // Upload through the real server, then invalidate the existing control through its user version.
            using var http = new HttpClient();
            using var texture = new SKBitmap(64, 32); texture.Erase(SKColors.Magenta);
            using (var paint = new SKPaint { Color = SKColors.Lime })
            using (var canvas = new SKCanvas(texture)) canvas.DrawRect(32, 0, 32, 32, paint);
            using var png = texture.Encode(SKEncodedImageFormat.Png, 100);
            using var upload = new ByteArrayContent(png.ToArray()); upload.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            using var response = await http.PostAsync(server.TrimEnd('/') + "/avatar?name=" + Uri.EscapeDataString("Renamed peer"), upload);
            response.EnsureSuccessStatusCode();
            var version = JsonNode.Parse(await response.Content.ReadAsStringAsync())!["avatar"]!.ToString();
            replacement["avatar"] = version; room.Refresh(); Check("texture version update");
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while ((!peer.IsCustomTexture || !peer.IsTextureReady) && DateTime.UtcNow < deadline) await Tick();
            if (!peer.IsCustomTexture || !peer.IsTextureReady || !peer.TextureKey.EndsWith(version)) throw new Exception("Retained portrait missed a custom texture version update.");
            Check("custom texture ready"); pass("Retained room portrait loads an uploaded custom texture without clearing its previous frame");

            using var parameters = new StringContent("{\"headSize\":0.25,\"handSize\":0.1}");
            parameters.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            using var changed = await http.PostAsync(server.TrimEnd('/') + "/avatar/params?name=" + Uri.EscapeDataString("Renamed peer"), parameters);
            changed.EnsureSuccessStatusCode();
            var nextVersion = JsonNode.Parse(await changed.Content.ReadAsStringAsync())!["avatar"]!.ToString();
            replacement["avatar"] = nextVersion; room.Refresh(); Check("manifest version update");
            deadline = DateTime.UtcNow.AddSeconds(15);
            while ((!peer.TextureKey.EndsWith(nextVersion) || !peer.IsTextureReady) && DateTime.UtcNow < deadline) await Tick();
            if (!peer.TextureKey.EndsWith(nextVersion) || !peer.IsTextureReady) throw new Exception("Retained portrait missed manifest update.");
            Check("manifest ready"); pass("Retained room portrait refreshes uploaded manifest parameters");

            // No extra chat arrives when the bubble expires; normal refresh must still hide it.
            state.Chats[0]!["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 31000;
            room.Refresh();
            if (Tile(peer).GetVisualDescendants().OfType<TextBlock>().Any(t => t.IsEffectivelyVisible && t.Text == "Hello")) throw new Exception("Expired bubble remains visible.");

            state.Users.Add(User("newcomer", 1.5)); room.Refresh(); await Tick();
            Check("participant joins");
            var newcomer = Portraits(room)["newcomer"];
            state.Users.Remove(replacement); room.Refresh();
            if (detaches != 1 || Field<object?>(peer, "bitmap") is not null || Field<object?>(peer, "raster") is not null || peer.IsTextureReady)
                throw new Exception("Leaving participant retained rendering resources.");
            if (Portraits(room).ContainsKey("peer")) throw new Exception("Leaving participant remains in room.");
            var departedFrames = peer.FrameCount; await Tick();
            if (peer.FrameCount != departedFrames) throw new Exception("Departed avatar continues to animate.");
            pass("Join keeps existing avatars; leave detaches and releases only the departing avatar");
            state.Users[2]!["pos"]!["x"] = 30; room.Refresh();
            if (Field<object?>(newcomer, "bitmap") is not null) throw new Exception("Out-of-range portrait resources were retained.");
            pass("Leaving the displayed distance range releases the hidden portrait resources");
            var remaining = Portraits(room).Values.ToArray();
            window.Close();
            if (remaining.Any(p => Field<object?>(p, "bitmap") is not null || Field<object?>(p, "raster") is not null)) throw new Exception("Room close retained portrait resources.");
            pass("Closing the room releases all remaining portrait rendering resources");

            void CaptureRoom(string name)
            {
                using var frame = window.CaptureRenderedFrame() ?? throw new Exception("Room frame unavailable.");
                frame.Save(Path.Combine(output, "room-layout-" + name + ".png"));
            }

            void Check(string label)
            {
                var current = Portraits(room);
                if (detaches != 0 || portraits.Any(p => !current.TryGetValue(p.Key, out var next) || !ReferenceEquals(next, p.Value)))
                    throw new Exception($"{label} detached or replaced a room avatar (detaches={detaches}).");
                if (portraits.Values.Any(p => Field<object?>(p, "bitmap") is null || p.LastFrameChecksum == 0))
                    throw new Exception(label + " cleared an already rendered avatar.");
                evidence.Add(new { scenario = label, detached = detaches, frames = portraits.ToDictionary(p => p.Key, p => p.Value.FrameCount) });
                Snapshot(peer, Path.Combine(output, "room-avatar-" + label.Replace(' ', '-') + ".png"));
            }
        }
        finally
        {
            window.Close();
            File.WriteAllText(Path.Combine(output, "room-avatar-lifecycle.json"), JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));
        }
        await VerifyPendingTexture(output, pass);
    }

    private static async Task VerifyPendingTexture(string output, Action<string> pass)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var accepted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var texture = new SKBitmap(32, 16); texture.Erase(SKColors.Gold);
        using var png = texture.Encode(SKEncodedImageFormat.Png, 100); var bytes = png.ToArray();
        var serve = Task.Run(async () =>
        {
            for (var i = 0; i < 2; i++)
            {
                using var request = await listener.AcceptTcpClientAsync();
                await using var stream = request.GetStream();
                using var reader = new StreamReader(stream, leaveOpen: true);
                while (await reader.ReadLineAsync() is { Length: > 0 }) { }
                accepted.TrySetResult(); await release.Task;
                var body = i == 0 ? bytes : Encoding.UTF8.GetBytes("{}");
                await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n"));
                await stream.WriteAsync(body);
            }
        });
        var user = User("pending", 0); user["avatar"] = "pending";
        var state = new ClientState { ServerUrl = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}", Users = new JsonArray(user) };
        await using var client = new TonariumClient(state, persistSettings: false);
        await using var media = new NativeMedia(client);
        var owner = new Window { Width = 240, Height = 180 };
        var portrait = new AvatarPortrait(new NativeContext(client, media, owner), "pending") { Width = 240, Height = 180 };
        owner.Content = portrait;
        try
        {
            owner.Show();
            owner.UpdateLayout();
            Snapshot(portrait, Path.Combine(output, "first-layout-pending-texture.png"));
            if (portrait.FrameCount == 0 || Field<object?>(portrait, "bitmap") is null) throw new Exception("First render waited for the animation timer to draw.");
            pass("First render produces visible pixels before a timer tick while a custom texture is pending");
            await accepted.Task.WaitAsync(TimeSpan.FromSeconds(5)); owner.Close(); release.TrySetResult();
            await serve.WaitAsync(TimeSpan.FromSeconds(5)); await Tick();
            if (portrait.IsTextureReady || Field<object?>(portrait, "bitmap") is not null || Field<object?>(portrait, "skin") is not null)
                throw new Exception("Late texture completion resurrected a detached portrait.");
            pass("Late texture completion cannot restore resources after the portrait detaches");
        }
        finally { owner.Close(); release.TrySetResult(); listener.Stop(); }
    }

    private static JsonObject User(string id, double x) => new()
    {
        ["id"] = id, ["name"] = id, ["session"] = "room", ["mode"] = "2d",
        ["pos"] = new JsonObject { ["x"] = x, ["z"] = 0 }
    };
    private static Dictionary<string, AvatarPortrait> Portraits(RoomView room) => room.GetVisualDescendants().OfType<AvatarPortrait>()
        .ToDictionary(p => Field<string>(p, "identity"));
    private static Border Tile(AvatarPortrait portrait) => portrait.GetVisualAncestors().OfType<Border>().Last(b => b.Parent is Canvas);
    private static void Snapshot(AvatarPortrait portrait, string path)
    {
        using var frame = new RenderTargetBitmap(new PixelSize((int)portrait.Bounds.Width, (int)portrait.Bounds.Height), new Vector(96, 96));
        frame.Render(portrait); frame.Save(path);
        using var decoded = SKBitmap.Decode(path);
        if (decoded.Pixels.Count(p => p.Alpha > 0) < 100 || decoded.Pixels.Distinct().Count() < 16) throw new Exception("Blank portrait frame: " + path);
    }
    private static T Field<T>(object target, string name) => (T)target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(target)!;
    private static async Task Tick() { await Task.Delay(180); AvaloniaHeadlessPlatform.ForceRenderTimerTick(2); }
}
