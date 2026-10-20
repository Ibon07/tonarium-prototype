using System.Security.Cryptography;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.VisualTree;
using SkiaSharp;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;

/// <summary>Normal media flows through production input parsing, uploads, room UI and viewer.</summary>
internal static class ChatMediaProbe
{
    public static async Task Run(string server, string output, Action<string> pass)
    {
        var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString()[^8..];
        await using var sender = new TonariumClient(new ClientState(), persistSettings: false);
        await using var receiver = new TonariumClient(new ClientState(), persistSettings: false);
        await using var nativeMedia = new NativeMedia(sender);
        var owner = new Window { Title = "Chat media verification", Width = 1360, Height = 880 };
        var context = new NativeContext(sender, nativeMedia, owner);
        var room = new RoomView(context);
        context.NotificationRequested = message => Console.WriteLine("UI " + message);
        owner.Content = room;
        sender.State.Changed += room.Refresh;
        var observations = new List<object>();
        try
        {
            owner.Show();
            await sender.ConnectAsync(server, "Media sender " + suffix);
            await receiver.ConnectAsync(server, "Media receiver " + suffix);
            var sessionName = "Media probe " + suffix;
            await sender.SendAsync(new { t = "sessionCreate", name = sessionName, topic = "Native image, clipboard and drop verification", world = "room", visibility = "public" });
            await Until(() => sender.State.Sessions.Any(s => J.Text(s, "name") == sessionName), "media test session creation");
            var sid = J.Text(sender.State.Sessions.First(s => J.Text(s, "name") == sessionName), "id");
            await sender.JoinAsync(sid); await receiver.JoinAsync(sid);
            await Until(() => sender.State.SyncStatus == "connected" && receiver.State.SyncStatus == "connected", "two native media clients join KokoSync");
            room.Refresh(); await Tick();
            pass("Two native clients share a media test room");

            var fixture = CreateFixture(output);
            var bytes = await File.ReadAllBytesAsync(fixture);
            var file = await owner.StorageProvider.TryGetFileFromPathAsync(fixture)
                ?? throw new InvalidOperationException("The native storage provider could not open the local image fixture.");
            var fileTransfer = new DataTransfer(); fileTransfer.Add(DataTransferItem.CreateFile(file));
            var fileContent = MediaInput.ReadDrop(fileTransfer);
            if (fileContent.Files.Count != 1 || fileContent.PngBytes is not null) throw new InvalidOperationException("File drop was not parsed as one storage file.");
            pass("Synthetic native file DataTransfer parsed without losing the file");

            var bitmapTransfer = BitmapTransfer(bytes);
            var bitmapContent = MediaInput.ReadDrop(bitmapTransfer);
            if (bitmapContent.Files.Count != 0 || bitmapContent.PngBytes is not { Length: > 0 }) throw new InvalidOperationException("Bitmap DataTransfer was not converted to PNG.");
            using (var bitmap = new Bitmap(new MemoryStream(bitmapContent.PngBytes)))
                if (bitmap.PixelSize != new PixelSize(640, 360)) throw new InvalidOperationException("Bitmap transfer dimensions changed.");
            pass("Synthetic native bitmap DataTransfer converts to 640×360 PNG");

            var uploaded = await MediaAttachments.UploadAsync(server, file);
            CheckMetadata(uploaded);
            using (var http = new HttpClient())
            {
                var downloaded = await http.GetByteArrayAsync(new Uri(new Uri(server.TrimEnd('/') + "/"), J.Text(uploaded, "url")));
                if (!SHA256.HashData(bytes).SequenceEqual(SHA256.HashData(downloaded))) throw new InvalidOperationException("Media upload changed the original file bytes.");
            }
            observations.Add(new { scenario = "upload-original", media = uploaded.DeepClone(), sha256 = Convert.ToHexString(SHA256.HashData(bytes)) });
            pass("Image upload preserves original bytes and 640×360 metadata");

            var firstMediaCount = MediaChats(receiver).Count;
            var firstItemCount = receiver.State.Items.Count;
            await room.DropMediaAsync(fileContent);
            await Until(() => MediaChats(receiver).Count == firstMediaCount + 1, "2D dropped image reaches peer chat");
            if (receiver.State.Items.Count != firstItemCount) throw new InvalidOperationException("2D image drop unexpectedly spawned a world item.");
            CheckMetadata(MediaChats(receiver).Last()["media"]!);
            pass("2D image drop posts inline chat media without spawning an item");
            await Until(() => owner.GetVisualDescendants().OfType<ChatMediaPreview>().Any(p => p.IsImageLoaded), "room image preview loads");
            var preview = owner.GetVisualDescendants().OfType<ChatMediaPreview>().Last();
            preview.BringIntoView(); await Tick();
            var previewImage = preview.GetVisualDescendants().OfType<Image>().Single();
            var ratio = previewImage.Bounds.Width / previewImage.Bounds.Height;
            if (Math.Abs(ratio - 640d / 360) > 0.05) throw new InvalidOperationException("Chat image preview does not preserve its source aspect ratio.");
            await Capture(owner, output, "01-inline-image");
            pass("Native inline preview renders at its original aspect ratio");

            var point = preview.TranslatePoint(new Point(preview.Bounds.Width / 2, preview.Bounds.Height / 2), owner)!.Value;
            owner.MouseDown(point, MouseButton.Left, RawInputModifiers.None); owner.MouseUp(point, MouseButton.Left, RawInputModifiers.None);
            await Until(() => owner.OwnedWindows.Any(w => w.Title == "画像 · Tonarium"), "click opens native image viewer");
            var viewer = owner.OwnedWindows.First(w => w.Title == "画像 · Tonarium");
            await Until(() => viewer.GetVisualDescendants().OfType<Image>().Any(i => i.Source is not null), "viewer original image loads");
            if (!viewer.GetVisualDescendants().OfType<Button>().Any(b => b.Content as string == "保存" && b.IsEnabled)) throw new InvalidOperationException("Viewer save button did not become enabled.");
            await Capture(viewer, output, "02-image-viewer");
            viewer.Activate(); Buttons(viewer).First(b => b.IsEnabled).Focus(); await Tick();
            viewer.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
            // Escape destroys this top-level immediately; key-up belongs to the reactivated owner.
            owner.KeyRelease(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
            await Until(() => !owner.OwnedWindows.Contains(viewer), "Escape closes native viewer");
            pass("Preview click opens full-size viewer, enables save and Escape closes it");

            var clipboard = owner.Clipboard ?? throw new InvalidOperationException("Headless clipboard unavailable.");
            await clipboard.SetDataAsync(BitmapTransfer(bytes));
            var clipboardContent = await MediaInput.ReadClipboardAsync(clipboard);
            if (clipboardContent.PngBytes is not { Length: > 0 }) throw new InvalidOperationException("Clipboard bitmap not read as PNG.");
            var beforePaste = MediaChats(receiver).Count;
            await room.PasteMediaAsync();
            await Until(() => MediaChats(receiver).Count == beforePaste + 1, "pasted clipboard image reaches peer");
            if (receiver.State.Items.Count != firstItemCount) throw new InvalidOperationException("2D pasted image unexpectedly spawned a world item.");
            pass("Production clipboard paste sends an inline 2D image to the peer");

            await sender.SendRoomAsync(new { t = "mode", mode = "3d" });
            await Until(() => sender.State.Mode == "3d", "3D media mode applied"); room.Refresh();
            var before3d = MediaChats(receiver).Count;
            await room.DropMediaAsync(bitmapContent);
            await Until(() => MediaChats(receiver).Count == before3d + 1 && receiver.State.Items.Count == firstItemCount + 1, "3D image drop reaches chat and creates item");
            var imageItem = receiver.State.Items.Last(p => J.Text(p.Value, "kind") == "image").Value!;
            observations.Add(new { scenario = "3d-drop", media = MediaChats(receiver).Last()["media"]!.DeepClone(), item = imageItem.DeepClone() });
            pass("3D image drop posts chat media and spawns a synchronized image item");
            await Capture(owner, output, "03-3d-image-drop");

            await sender.SendAsync(new { t = "friendRequest", to = receiver.State.SelfId });
            await Until(() => receiver.State.Notifications.Any(n => J.Text(n, "from") == sender.State.SelfId), "media DM friend request arrives");
            await receiver.SendAsync(new { t = "friendAccept", to = sender.State.SelfId });
            await Until(() => sender.State.Friends.Any(n => n?.ToString() == receiver.State.Name), "media DM friendship established");
            var conversation = "dm:" + string.Join('\0', new[] { sender.State.Name, receiver.State.Name }.Order(StringComparer.Ordinal));
            await sender.SendAsync(new { t = "msg", conv = conversation, text = "Media DM " + suffix });
            await Until(() => sender.State.Conversations[conversation] is JsonArray { Count: > 0 }, "DM exists for media test");
            Click(owner, b => b.Content as string == "メッセージ");
            await Until(() => owner.OwnedWindows.Any(w => Buttons(w).Any(b => b.Content as string == receiver.State.Name)), "conversation picker opens");
            var conversations = owner.OwnedWindows.First(w => Buttons(w).Any(b => b.Content as string == receiver.State.Name));
            Click(conversations, b => b.Content as string == receiver.State.Name); conversations.Close();
            var itemsBeforeDm = receiver.State.Items.Count;
            await room.DropMediaAsync(fileContent);
            await Until(() => receiver.State.Conversations[conversation] is JsonArray messages && messages.Any(m => m?["media"] is JsonObject), "dropped image reaches selected DM");
            if (receiver.State.Items.Count != itemsBeforeDm) throw new InvalidOperationException("Dropping into a DM spawned a world item in 3D mode.");
            pass("Selected DM receives dropped image without a 3D world item");
            await Until(() => owner.GetVisualDescendants().OfType<ChatMediaPreview>().Any(p => p.IsImageLoaded), "DM image preview loads");
            await Capture(owner, output, "04-dm-image-preview");
            observations.Add(new { scenario = "dm-drop", conversation, items = receiver.State.Items.Count, message = ((JsonArray)receiver.State.Conversations[conversation]!).Last()!.DeepClone() });

            preview = owner.GetVisualDescendants().OfType<ChatMediaPreview>().Last(); owner.Activate(); preview.BringIntoView(); preview.Focus();
            owner.KeyPress(Key.Enter, RawInputModifiers.None, PhysicalKey.Enter, null); owner.KeyRelease(Key.Enter, RawInputModifiers.None, PhysicalKey.Enter, null);
            await Until(() => owner.OwnedWindows.Any(w => w.Title == "画像 · Tonarium"), "keyboard opens DM image viewer");
            viewer = owner.OwnedWindows.First(w => w.Title == "画像 · Tonarium");
            Click(viewer, b => AutomationProperties.GetName(b) == "画像を閉じる");
            await Until(() => !owner.OwnedWindows.Contains(viewer), "native close button closes image viewer");
            pass("DM image supports keyboard opening and native close button");

            var videoPath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "red-blue-4s.mp4");
            await using (var input = File.OpenRead(videoPath))
            {
                var video = await MediaAttachments.UploadAsync(server, input, "red-blue-4s.mp4");
                if (J.Text(video, "kind") != "video" || J.Number(video, "w") != 640 || J.Number(video, "h") != 360)
                    throw new InvalidOperationException("Video upload did not preserve 640×360 MP4 metadata: " + video.ToJsonString());
                observations.Add(new { scenario = "video-metadata", media = video });
                pass("Normal MP4 upload identifies video and preserves 640×360 metadata");
            }
            await CheckMainWindowTextPaste(server, output, pass);
        }
        finally
        {
            File.WriteAllText(Path.Combine(output, "chat-media-details.json"), JsonSerializer.Serialize(observations, new JsonSerializerOptions { WriteIndented = true }));
            foreach (var window in owner.OwnedWindows.ToArray()) window.Close();
            owner.Close(); sender.State.Changed -= room.Refresh;
            await receiver.LeaveAsync(); await sender.LeaveAsync();
        }
    }

    private static async Task CheckMainWindowTextPaste(string server, string output, Action<string> pass)
    {
        var main = new MainWindow();
        var client = Private<TonariumClient>(main, "client");
        typeof(TonariumClient).GetField("persistSettings", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(client, false);
        client.State.SelfId = Guid.NewGuid().ToString();
        try
        {
            main.Show(); await Tick();
            Private<TextBox>(main, "serverInput").Text = server;
            Private<TextBox>(main, "nameInput").Text = "Media paste " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString()[^8..];
            Click(main, b => b.Content as string == "はじめる");
            await Until(() => client.State.Connected, "main window paste client connects");
            var name = "Text paste " + Guid.NewGuid().ToString("N")[..8];
            await client.SendAsync(new { t = "sessionCreate", name, world = "room", visibility = "public" });
            await Until(() => client.State.Sessions.Any(s => J.Text(s, "name") == name), "paste test session created");
            await client.JoinAsync(J.Text(client.State.Sessions.First(s => J.Text(s, "name") == name), "id"));
            await Until(() => client.State.SyncStatus == "connected" && main.GetVisualDescendants().OfType<RoomView>().Any(), "main paste room ready");
            var text = "通常テキストの貼り付け";
            var transfer = new DataTransfer(); transfer.Add(DataTransferItem.CreateText(text));
            await main.Clipboard!.SetDataAsync(transfer);
            var composer = main.GetVisualDescendants().OfType<TextBox>().First(t => t.PlaceholderText?.Contains("声の届く範囲") == true);
            main.Activate(); composer.Focus();
            main.KeyPress(Key.V, RawInputModifiers.Control, PhysicalKey.V, "v"); main.KeyRelease(Key.V, RawInputModifiers.Control, PhysicalKey.V, "v");
            await Until(() => composer.Text == text, "plain clipboard text survives MainWindow paste tunnel");
            if (client.State.Chats.Any(c => c?["media"] is JsonObject)) throw new InvalidOperationException("Plain text paste unexpectedly uploaded media.");
            await Capture(main, output, "05-main-text-paste");
            pass("MainWindow Ctrl+V preserves native plain text insertion without media upload");
        }
        finally { main.Close(); await Task.Delay(200); }
    }

    private static T Private<T>(object value, string name) => (T)value.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(value)!;

    private static List<JsonNode> MediaChats(TonariumClient client) => client.State.Chats.Where(c => c?["media"] is JsonObject).Select(c => c!).ToList();
    private static void CheckMetadata(JsonNode media)
    {
        if (J.Text(media, "kind") != "image" || J.Number(media, "w") != 640 || J.Number(media, "h") != 360 || !J.Text(media, "url").StartsWith('/'))
            throw new InvalidOperationException("Unexpected uploaded image metadata: " + media.ToJsonString());
    }
    private static DataTransfer BitmapTransfer(byte[] png)
    {
        // Clipboard readers own/dispose the bitmap they receive. Return a new bitmap for each read.
        var result = new DataTransfer(); var item = new DataTransferItem(); item.Set(DataFormat.Bitmap, () => new Bitmap(new MemoryStream(png))); result.Add(item); return result;
    }
    private static IEnumerable<Button> Buttons(Visual root) => root.GetVisualDescendants().OfType<Button>();
    private static void Click(Visual root, Func<Button, bool> matches) => Buttons(root).First(matches).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static async Task Tick() { await Task.Delay(150); AvaloniaHeadlessPlatform.ForceRenderTimerTick(2); }
    private static async Task Until(Func<bool> condition, string label)
    {
        var deadline = DateTime.UtcNow.AddSeconds(35);
        while (DateTime.UtcNow < deadline) { if (condition()) { await Tick(); return; } await Tick(); }
        throw new TimeoutException(label);
    }
    private static async Task Capture(Window window, string directory, string name)
    {
        await Tick(); using var frame = window.CaptureRenderedFrame() ?? throw new InvalidOperationException("No native media frame."); frame.Save(Path.Combine(directory, name + ".png"));
    }
    private static string CreateFixture(string directory)
    {
        var path = Path.Combine(directory, "chat-image-fixture.png");
        using var bitmap = new SKBitmap(640, 360); using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColor.Parse("#D9EEF7"));
        using var paint = new SKPaint { Color = SKColor.Parse("#2F5FC4"), IsAntialias = true };
        canvas.DrawRoundRect(new SKRect(32, 32, 608, 328), 24, 24, paint);
        paint.Color = SKColor.Parse("#FFD36C"); canvas.DrawCircle(176, 180, 88, paint);
        paint.Color = SKColors.White; canvas.DrawRoundRect(new SKRect(318, 102, 552, 128), 13, 13, paint); canvas.DrawRoundRect(new SKRect(318, 166, 520, 192), 13, 13, paint); canvas.DrawRoundRect(new SKRect(318, 230, 472, 256), 13, 13, paint);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100); using var output = File.Create(path); encoded.SaveTo(output); return path;
    }

}
