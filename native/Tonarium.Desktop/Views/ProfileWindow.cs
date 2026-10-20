using System.Diagnostics;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Tonarium.Desktop.Core;
using Drawing = System.Drawing;

namespace Tonarium.Desktop.Views;

/// <summary>Server-backed profile editing and the native participant action card.</summary>
public sealed class ProfileWindow : Window
{
    private readonly NativeContext context;
    private readonly string name;
    private readonly string userId;
    private readonly bool self;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly StackPanel body = new() { Spacing = 18 };
    private readonly TextBlock feedback = Ui.Text("", 12, Ui.Purple);
    private readonly TextBlock presence = Ui.Text("", 12, Ui.Muted);
    private readonly Image portrait = new() { Width = 80, Height = 80, Stretch = Stretch.UniformToFill };
    private readonly Image texture = new() { Height = 170, Stretch = Stretch.Uniform };
    private readonly TextBlock avatarHint = Ui.Text("アバター未設定の間は、サンプルの姿で参加します。", 12, Ui.Muted);
    private TextBox? bio;
    private Button? friendButton, followButton, blockButton;
    private Bitmap? portraitBitmap, textureBitmap;
    private bool requested, closed;

    public ProfileWindow(NativeContext context, string userIdOrName)
    {
        this.context = context;
        var person = context.State.Users.FirstOrDefault(x => J.Text(x, "id") == userIdOrName || J.Text(x, "name") == userIdOrName);
        name = J.Text(person, "name", userIdOrName).Trim();
        userId = J.Text(person, "id", userIdOrName == context.State.Name ? context.State.SelfId : "");
        self = userId == context.State.SelfId || name == context.State.Name;
        Title = name + " のプロフィール · tonarium";
        Width = 620; Height = self ? 830 : 590; MinWidth = 440; MinHeight = 390;
        Background = Ui.Brush(Ui.Background); FontFamily = new FontFamily("Yu Gothic UI, Segoe UI");
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var root = new DockPanel { Margin = new Thickness(24), Background = Ui.Brush(Ui.Background) };
        var footer = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), ColumnSpacing = 14, Margin = new Thickness(0, 18, 0, 0) };
        footer.Children.Add(feedback); var close = Ui.Button("閉じる", Close); Grid.SetColumn(close, 1); footer.Children.Add(close);
        DockPanel.SetDock(footer, Dock.Bottom); root.Children.Add(footer);
        root.Children.Add(new ScrollViewer { Content = body, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
        Content = root;
        BuildHeader();
        if (self) BuildEditor(); else BuildParticipant(person);
        Opened += async (_, _) => await RunAsync(LoadAsync);
        context.State.Changed += RefreshActions;
        Closed += (_, _) => { closed = true; context.State.Changed -= RefreshActions; portraitBitmap?.Dispose(); textureBitmap?.Dispose(); http.Dispose(); };
        RefreshActions();
    }

    private void BuildHeader()
    {
        var monogram = Ui.Text(name.Length > 0 ? name[..1] : "と", 32, Ui.Purple);
        monogram.HorizontalAlignment = HorizontalAlignment.Center;
        var imageHost = new Grid { Width = 80, Height = 80 };
        imageHost.Children.Add(monogram); imageHost.Children.Add(portrait);
        var face = new Border { Child = imageHost, Background = Ui.Brush("#E9E1ED"), CornerRadius = new CornerRadius(24), ClipToBounds = true };
        var title = Ui.Text(name, 25); title.FontWeight = FontWeight.Bold;
        var labels = Ui.Column(title, presence); labels.VerticalAlignment = VerticalAlignment.Center;
        body.Children.Add(Ui.Row(face, labels));
    }

    private void BuildEditor()
    {
        presence.Text = "プロフィールは同じ名前で共有されます";
        bio = new TextBox { PlaceholderText = "自己紹介を書いてみましょう", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxLength = 300, MinHeight = 105, CornerRadius = new CornerRadius(12) };
        var count = Ui.Text("0 / 300", 11, Ui.Muted);
        bio.TextChanged += (_, _) => count.Text = $"{bio.Text?.Length ?? 0} / 300";
        body.Children.Add(Section("自己紹介", bio, Ui.Row(count, ActionButton("保存する", SaveBioAsync))));
        body.Children.Add(Section("2D のアイコン", Ui.Text("画像の中央を正方形に切り抜き、128 × 128 の JPEG として保存します。", 12, Ui.Muted), ActionButton("画像を選ぶ", () => UploadImageAsync(false))));
        texture.IsVisible = false;
        body.Children.Add(Section("3D のお絵描きアバター", texture, avatarHint,
            Ui.Text("2048 × 1024 のテンプレートに描いた画像を使います。調整値は manifest.json から読み込めます。", 12, Ui.Muted),
            Ui.Row(ActionButton("画像を選ぶ", () => UploadImageAsync(true)), ActionButton("調整値を選ぶ", UploadManifestAsync)),
            Ui.Row(ActionButton("テンプレートを保存", SaveTemplateAsync), Ui.Button("お絵描きサイト ↗", () => Launch("https://oekaki-avatar.anthrotech.dev/")))));
        var scale = new ComboBox { ItemsSource = new[] { "なし", "× 0.5", "× 1（標準）", "× 2", "× 3" }, MinWidth = 150 };
        var values = new[] { 0d, .5, 1, 2, 3 };
        var current = double.TryParse(NativeSettings.GetString("loadScale", "1"), CultureInfo.InvariantCulture, out var n) ? n : 1;
        scale.SelectedIndex = Math.Max(0, Array.IndexOf(values, current));
        scale.SelectionChanged += (_, _) => { if (scale.SelectedIndex >= 0) NativeSettings.SetString("loadScale", values[scale.SelectedIndex].ToString(CultureInfo.InvariantCulture)); };
        body.Children.Add(Section("2D / 3D 切り替え", Ui.Text("演出の読み込み時間。この端末に保存されます。エンジン起動の待ち時間は別にかかります。", 12, Ui.Muted), scale));
    }

    private void BuildParticipant(JsonNode? person)
    {
        var biography = Ui.Text(J.Text(person, "bio", "自己紹介はまだありません"), 15);
        biography.Tag = "biography";
        body.Children.Add(biography);
        var near = ActionButton("そばにいく", GoNearAsync);
        followButton = ActionButton("ついていく", () => context.Client.SendRoomAsync(new { t = "follow", target = J.Text(context.State.Presence[context.State.SelfId], "follow") == userId ? null : userId }));
        var poke = ActionButton("つんつん", () => context.Client.SendRoomAsync(new { t = "poke", to = userId }));
        near.IsEnabled = poke.IsEnabled = context.State.SessionId is not null && J.Text(person, "session") == context.State.SessionId;
        body.Children.Add(Ui.Row(near, followButton, poke));
        friendButton = ActionButton("フレンド申請", async () =>
        {
            var inbound = HasFriendRequest();
            await context.Client.SendAsync(new { t = inbound ? "friendAccept" : "friendRequest", to = userId });
            if (inbound)
                foreach (var notification in context.State.Notifications.OfType<JsonObject>().Where(x => J.Text(x, "t") == "friendRequest" && J.Text(x, "from") == userId).ToArray()) context.State.Notifications.Remove(notification);
            else requested = true;
            feedback.Text = inbound ? "フレンド申請を承認しました" : "フレンド申請を送りました";
            RefreshActions();
        });
        friendButton.IsEnabled = userId.Length > 0;
        var message = Ui.Button("メッセージ", () => { context.ShowHome("dm:" + name); Close(); });
        body.Children.Add(Ui.Row(friendButton, message));
        blockButton = Ui.Button("ブロック", () =>
        {
            var blocked = !NativeSettings.BlockedNames.Contains(name);
            NativeSettings.SetBlocked(name, blocked); context.State.Touch(); RefreshActions();
            feedback.Text = blocked ? "ブロックしました。この端末に保存されます" : "ブロックを解除しました";
        });
        var reason = new TextBox { PlaceholderText = "何があったかを書いてください", MaxLength = 500, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 90 };
        var report = Section("通報の理由", reason, ActionButton("通報を送る", async () =>
        {
            if (string.IsNullOrWhiteSpace(reason.Text)) { feedback.Text = "通報の理由を入力してください"; return; }
            await PostJsonAsync("/report", new JsonObject { ["from"] = context.State.Name, ["target"] = name, ["reason"] = reason.Text.Trim() });
            feedback.Text = "通報を送りました。ありがとうございます"; reason.Text = "";
        }));
        report.IsVisible = false;
        body.Children.Add(Ui.Row(blockButton, Ui.Button("通報", () => report.IsVisible = !report.IsVisible)));
        body.Children.Add(report);
    }

    private bool HasFriendRequest() => context.State.Notifications.Any(x => J.Text(x, "t") == "friendRequest" && J.Text(x, "from") == userId);
    private void RefreshActions()
    {
        if (closed || self) return;
        var person = context.State.Users.FirstOrDefault(x => J.Text(x, "id") == userId);
        var isFriend = context.State.Friends.Any(x => J.Value(x) == name);
        presence.Text = person is null ? "オフライン" : $"{(J.Text(person, "mode") == "3d" ? "3D" : "2D")} で参加中" + (isFriend ? " · フレンド" : "");
        if (friendButton is not null) { friendButton.Content = isFriend ? "✓ フレンド" : HasFriendRequest() ? "フレンド申請を承認" : requested ? "申請しました" : "フレンド申請"; friendButton.IsEnabled = userId.Length > 0 && !isFriend && !requested; }
        if (followButton is not null)
        {
            followButton.Content = J.Text(context.State.Presence[context.State.SelfId], "follow") == userId ? "ついていくのをやめる" : "ついていく";
            followButton.IsEnabled = context.State.Mode == "2d" && J.Text(person, "mode") == "3d" && context.State.SessionId is not null && J.Text(person, "session") == context.State.SessionId;
        }
        if (blockButton is not null) blockButton.Content = NativeSettings.BlockedNames.Contains(name) ? "ブロック解除" : "ブロック";
    }

    private async Task LoadAsync()
    {
        var document = JsonNode.Parse(await http.GetStringAsync(Endpoint("/profile")));
        if (closed) return;
        if (bio is not null) bio.Text = J.Text(document, "bio");
        else if (body.Children.OfType<TextBlock>().FirstOrDefault(x => x.Tag as string == "biography") is { } text) text.Text = J.Text(document, "bio") is { Length: > 0 } value ? value : "自己紹介はまだありません";
        await Task.WhenAll(LoadImageAsync(false), self ? LoadImageAsync(true) : Task.CompletedTask);
    }

    private async Task LoadImageAsync(bool avatar)
    {
        using var response = await http.GetAsync(Endpoint(avatar ? "/avatar" : "/icon") + "&t=" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (closed) return;
        byte[] bytes;
        if (response.IsSuccessStatusCode) bytes = await response.Content.ReadAsByteArrayAsync();
        else if (avatar && response.StatusCode == System.Net.HttpStatusCode.NotFound)
            bytes = await http.GetByteArrayAsync(context.State.ServerUrl.TrimEnd('/') + "/oekaki/sample.png");
        else return;
        if (closed) return;
        using var memory = new MemoryStream(bytes); var image = new Bitmap(memory);
        if (avatar) { texture.Source = image; texture.IsVisible = true; avatarHint.IsVisible = false; textureBitmap?.Dispose(); textureBitmap = image; }
        else { portrait.Source = image; portraitBitmap?.Dispose(); portraitBitmap = image; }
    }

    private async Task SaveBioAsync()
    {
        await PostJsonAsync("/profile", new JsonObject { ["bio"] = bio?.Text ?? "" });
        await ProfileUpdatedAsync(); feedback.Text = "自己紹介を保存しました";
    }

    private async Task UploadImageAsync(bool avatar)
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions { Title = avatar ? "アバター画像を選ぶ" : "アイコン画像を選ぶ", AllowMultiple = false, FileTypeFilter = [FilePickerFileTypes.ImageAll] });
        if (files.Count == 0) return;
        await using var source = await files[0].OpenReadAsync();
        using var input = new MemoryStream(); await source.CopyToAsync(input); input.Position = 0;
        using var original = Drawing.Image.FromStream(input);
        if (original.PropertyIdList.Contains(0x0112) && original.GetPropertyItem(0x0112)?.Value is { Length: >= 2 } orientation)
        {
            var rotation = BitConverter.ToUInt16(orientation, 0) switch
            {
                2 => Drawing.RotateFlipType.RotateNoneFlipX, 3 => Drawing.RotateFlipType.Rotate180FlipNone,
                4 => Drawing.RotateFlipType.Rotate180FlipX, 5 => Drawing.RotateFlipType.Rotate90FlipX,
                6 => Drawing.RotateFlipType.Rotate90FlipNone, 7 => Drawing.RotateFlipType.Rotate270FlipX,
                8 => Drawing.RotateFlipType.Rotate270FlipNone, _ => Drawing.RotateFlipType.RotateNoneFlipNone
            };
            original.RotateFlip(rotation);
        }
        using var output = new Drawing.Bitmap(avatar ? 2048 : 128, avatar ? 1024 : 128, Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var graphics = Drawing.Graphics.FromImage(output))
        {
            graphics.InterpolationMode = Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.CompositingQuality = Drawing.Drawing2D.CompositingQuality.HighQuality;
            graphics.PixelOffsetMode = Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            if (avatar) graphics.DrawImage(original, new Drawing.Rectangle(0, 0, 2048, 1024));
            else
            {
                graphics.Clear(Drawing.Color.White);
                var size = Math.Min(original.Width, original.Height);
                graphics.DrawImage(original, new Drawing.Rectangle(0, 0, 128, 128), new Drawing.Rectangle((original.Width - size) / 2, (original.Height - size) / 2, size, size), Drawing.GraphicsUnit.Pixel);
            }
        }
        using var encoded = new MemoryStream();
        if (avatar) output.Save(encoded, Drawing.Imaging.ImageFormat.Png);
        else
        {
            var codec = Drawing.Imaging.ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == Drawing.Imaging.ImageFormat.Jpeg.Guid);
            using var parameters = new Drawing.Imaging.EncoderParameters(1);
            parameters.Param[0] = new Drawing.Imaging.EncoderParameter(Drawing.Imaging.Encoder.Quality, 85L);
            output.Save(encoded, codec, parameters);
        }
        using var content = new ByteArrayContent(encoded.ToArray()); content.Headers.ContentType = new MediaTypeHeaderValue(avatar ? "image/png" : "image/jpeg");
        using var result = await http.PostAsync(Endpoint(avatar ? "/avatar" : "/icon"), content); result.EnsureSuccessStatusCode();
        await ProfileUpdatedAsync(); await LoadImageAsync(avatar); feedback.Text = avatar ? "アバター画像を保存しました" : "アイコンを保存しました";
    }

    private async Task UploadManifestAsync()
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions { Title = "manifest.json を選ぶ", AllowMultiple = false, FileTypeFilter = [new FilePickerFileType("JSON") { Patterns = ["*.json"], MimeTypes = ["application/json"] }] });
        if (files.Count == 0) return;
        await using var stream = await files[0].OpenReadAsync(); using var reader = new StreamReader(stream);
        var manifest = JsonNode.Parse(await reader.ReadToEndAsync()) as JsonObject ?? throw new IOException("JSON の形式を確認してください。");
        await PostJsonAsync("/avatar/params", manifest["params"] ?? manifest); await ProfileUpdatedAsync(); feedback.Text = "アバターの調整値を保存しました";
    }

    private async Task SaveTemplateAsync()
    {
        var file = await StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions { Title = "テンプレートを保存", SuggestedFileName = "oekaki-template.png", DefaultExtension = ".png", FileTypeChoices = [FilePickerFileTypes.ImagePng] });
        if (file is null) return;
        var bytes = await http.GetByteArrayAsync(context.State.ServerUrl.TrimEnd('/') + "/oekaki/template.png");
        await using var output = await file.OpenWriteAsync(); output.SetLength(0); await output.WriteAsync(bytes); feedback.Text = "テンプレートを保存しました";
    }

    private async Task GoNearAsync()
    {
        var target = ResolvePosition(userId); var me = ResolvePosition(context.State.SelfId);
        var dx = me.X - target.X; var dz = me.Z - target.Z; var distance = Math.Sqrt(dx * dx + dz * dz);
        if (distance < .01) { dx = 0; dz = 1; } else { dx /= distance; dz /= distance; }
        var x = Math.Clamp(target.X + dx, -9.5, 9.5); var z = Math.Clamp(target.Z + dz, -9.5, 9.5); var ry = Math.Atan2(-(target.X - x), -(target.Z - z));
        if (context.State.Mode == "3d")
        {
            await context.TeleportAsync(x, z, ry);
        }
        else await context.Client.SendRoomAsync(new { t = "place2d", target = context.State.SelfId, pos = new { x, z, ry } });
        feedback.Text = name + " のそばへ移動しました";
    }

    private (double X, double Z) ResolvePosition(string id)
    {
        var users = context.State.Users.Where(x => J.Text(x, "session") == context.State.SessionId).ToArray();
        var places = new Dictionary<string, (double X, double Z, double Yaw)>();
        foreach (var user in users.Where(x => J.Text(x, "mode") == "3d"))
        {
            var key = J.Text(user, "id"); var avatar = context.State.Avatars[key];
            places[key] = (J.Number(avatar, "x"), J.Number(avatar, "z"), J.Number(avatar, "ry"));
        }
        var followers = new Dictionary<string, int>(); var queue = 0;
        foreach (var user in users.Where(x => J.Text(x, "mode") != "3d"))
        {
            var key = J.Text(user, "id"); var presence = context.State.Presence[key]; var followed = J.Text(presence, "follow");
            if (places.TryGetValue(followed, out var target))
            {
                var index = followers.GetValueOrDefault(followed); followers[followed] = index + 1;
                var side = (index % 2 == 1 ? -1 : 1) * Math.Ceiling(index / 2d) * .45; var back = .9 + Math.Floor(index / 3d) * .35;
                places[key] = (target.X + Math.Sin(target.Yaw) * back + Math.Cos(target.Yaw) * side, target.Z + Math.Cos(target.Yaw) * back - Math.Sin(target.Yaw) * side, target.Yaw);
            }
            else if (presence?["pos"] is { } pos) places[key] = (J.Number(pos, "x"), J.Number(pos, "z"), J.Number(pos, "ry"));
            else
            {
                var radius = .45 * Math.Sqrt(queue); var angle = queue++ * 2.39996;
                places[key] = (Math.Sin(angle) * radius, 6.5 + Math.Cos(angle) * radius, 0);
            }
        }
        var place = places.GetValueOrDefault(id, (0, 6.5, 0));
        return (place.Item1, place.Item2);
    }

    private async Task PostJsonAsync(string path, JsonNode payload)
    {
        using var content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await http.PostAsync(path == "/report" ? context.State.ServerUrl.TrimEnd('/') + path : Endpoint(path), content);
        response.EnsureSuccessStatusCode();
    }
    private async Task ProfileUpdatedAsync() { if (context.State.Connected) await context.Client.SendAsync(new { t = "profileUpdated" }); }
    private string Endpoint(string path) => context.State.ServerUrl.TrimEnd('/') + path + "?name=" + Uri.EscapeDataString(name);
    private Button ActionButton(string label, Func<Task> action) => Ui.Button(label, () => _ = RunAsync(action));
    private async Task RunAsync(Func<Task> action)
    {
        try { await action(); }
        catch (Exception ex) { if (!closed) feedback.Text = "操作できませんでした: " + ex.Message; }
    }
    private static Control Section(string title, params Control[] children)
    {
        var header = Ui.Text(title, 15); header.FontWeight = FontWeight.SemiBold;
        var column = Ui.Column(header); foreach (var child in children) column.Children.Add(child); return Ui.Card(column);
    }
    private void Launch(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { feedback.Text = ex.Message; }
    }
}
