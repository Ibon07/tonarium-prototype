using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using System.Text.Json.Nodes;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.ThreeD;

namespace Tonarium.Desktop.Views;

public sealed class MainWindow : Window
{
    private readonly TonariumClient client = new(persistSettings: !Program.Arguments.Contains("--demo") && !Program.Arguments.Contains("--smoke"));
    private readonly NativeMedia media;
    private readonly ThreeDHost threeD;
    private readonly NativeContext context;
    private readonly Grid root = new();
    private readonly ContentControl screen = new();
    private readonly TextBlock status = Ui.Text("", 11, Ui.Muted);
    private readonly Border toast;
    private readonly TextBlock toastText = Ui.Text("", 14, "#FFFFFF");
    private readonly Dictionary<string, ItemWindow> itemWindows = [];
    private HomeView? home;
    private RoomView? room;
    private Window? homeOverlay;
    private HomeView? overlayView;
    private UnitySurface? unitySurface;
    private string? previousSession;
    private bool signedIn, closing, refreshQueued, switching;
    private readonly TextBox serverInput;
    private readonly TextBox nameInput;
    private readonly TextBlock loginError = Ui.Text("", 13, "#C2402F");
    private Button? connectButton;

    public MainWindow()
    {
        Title = "Tonarium";
        Width = 1360; Height = 880; MinWidth = 1000; MinHeight = 640;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        media = new NativeMedia(client);
        threeD = new ThreeDHost(client);
        threeD.AttachMedia(media);
        context = new(client, media, this)
        {
            NotificationRequested = Notify,
            ItemRequested = OpenItem,
            ProfileRequested = ShowProfile,
            HomeRequested = ShowHome,
            ModeRequested = ChangeMode,
            TeleportRequested = (x, z, ry) => threeD.TeleportAsync(x, z, ry)
        };
        serverInput = Ui.Input("http://localhost:3001", Program.Argument("--server") ?? client.State.ServerUrl);
        nameInput = Ui.Input("なまえ", Program.Argument("--name") ?? client.State.Name);
        toast = new Border { Child = toastText, Background = Ui.Brush("#ED26262E"), CornerRadius = new(12), Padding = new(20, 12), Margin = new(24, 24, 24, 40), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, MaxWidth = 760, IsVisible = false };
        var body = new Grid { RowDefinitions = new RowDefinitions("*,24") };
        body.Children.Add(screen);
        var footer = new Border { Child = status, Padding = new Thickness(16, 2), Background = Ui.Brush("#F3EEE4") };
        Grid.SetRow(footer, 1); body.Children.Add(footer);
        root.Children.Add(body); root.Children.Add(toast);
        Content = root;
        screen.Content = LoginView();
        client.State.Changed += QueueRefresh;
        client.MessageReceived += MessageReceived;
        media.Changed += QueueRefresh;
        threeD.ReturnedTo2D += () => Dispatcher.UIThread.Post(() => { room?.SetThreeDSurface(null); unitySurface = null; Activate(); QueueRefresh(); });
        threeD.PlayerWindowChanged += hwnd => Dispatcher.UIThread.Post(() => unitySurface?.ResizePlayer(hwnd));
        threeD.ItemRequested += id => { OpenItem(id); Activate(); };
        Closing += (_, e) =>
        {
            if (closing) return;
            e.Cancel = true;
            _ = Shutdown();
        };
        KeyDown += (_, e) => { if (e.Key == Key.Escape && homeOverlay is not null) homeOverlay.Close(); };
        Opened += async (_, _) =>
        {
            if (Program.Arguments.Contains("--media-smoke"))
            {
                var resultPath = Program.Argument("--output") ?? Path.Combine(AppContext.BaseDirectory, "media-smoke.json");
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(resultPath))!);
                try { var result = await NativeMediaSmoke.RunAsync(); await File.WriteAllTextAsync(resultPath, result.ToJsonString()); }
                catch (Exception e) { Program.Log(e.ToString()); await File.WriteAllTextAsync(resultPath, new JsonObject { ["passed"] = false, ["error"] = e.Message }.ToJsonString()); }
                await Shutdown(); return;
            }
            if (Program.Arguments.Contains("--demo")) { LoadDemo(); return; }
            if (Program.Arguments.Contains("--connect") || Program.Argument("--smoke") is not null)
            {
                await Connect();
                if (Program.Argument("--smoke") is { } directory) _ = RunSmoke(directory);
            }
        };
    }

    private Control LoginView()
    {
        var card = Ui.Column();
        try
        {
            using var asset = AssetLoader.Open(new Uri("avares://Tonarium/Assets/brand/logo.png"));
            card.Children.Add(new Image { Source = new Bitmap(asset), Width = 240, Height = 85, Stretch = Stretch.Uniform, Margin = new(0, 0, 0, 16) });
        }
        catch { card.Children.Add(Ui.Title("Tonarium")); }
        card.Children.Add(Ui.Text("同じ場所に、好きなかたちで。", 20));
        card.Children.Add(Ui.Text("名前を決めて、みんなのいる場所へ。", 13, Ui.Muted));
        card.Children.Add(Ui.Text("なまえ", 12, Ui.Muted)); card.Children.Add(nameInput);
        var server = new Expander { Header = "接続先", Content = serverInput, IsExpanded = string.IsNullOrEmpty(client.State.Name) };
        card.Children.Add(server);
        connectButton = Ui.Button("はじめる", () => _ = Connect());
        connectButton.Background = Ui.Brush("#2F5FC4"); connectButton.Foreground = Brushes.White; connectButton.HorizontalContentAlignment = HorizontalAlignment.Center;
        card.Children.Add(connectButton); card.Children.Add(loginError);
        var panel = Ui.Card(card); panel.Width = 430; panel.Padding = new Thickness(32); panel.CornerRadius = new(24);
        var stage = new Grid { Width = 680, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        foreach (var (name, align, margin) in new[] { ("tona.webp", HorizontalAlignment.Left, new Thickness(0, 85, 0, 0)), ("rimu.webp", HorizontalAlignment.Right, new Thickness(0, -90, 0, 0)) })
        {
            try
            {
                using var asset = AssetLoader.Open(new Uri("avares://Tonarium/Assets/brand/" + name));
                stage.Children.Add(new Image { Source = new Bitmap(asset), Width = 145, Height = 180, Stretch = Stretch.Uniform, HorizontalAlignment = align, Margin = margin });
            }
            catch { }
        }
        stage.Children.Add(panel);
        nameInput.KeyDown += (_, e) => { if (e.Key == Key.Enter) _ = Connect(); };
        return stage;
    }

    private async Task Connect()
    {
        if (connectButton is { IsEnabled: false }) return;
        if (string.IsNullOrWhiteSpace(nameInput.Text)) { loginError.Text = "なまえを入力してください"; nameInput.Focus(); return; }
        if (connectButton is not null) connectButton.IsEnabled = false;
        loginError.Text = "";
        try { await client.ConnectAsync(serverInput.Text ?? "", nameInput.Text); signedIn = true; Refresh(); }
        catch (Exception e) { loginError.Text = e.Message; Program.Log(e.ToString()); }
        finally { if (connectButton is not null) connectButton.IsEnabled = true; }
    }

    private void QueueRefresh()
    {
        if (refreshQueued || closing) return;
        refreshQueued = true;
        Dispatcher.UIThread.Post(async () => { await Task.Delay(80); refreshQueued = false; if (!closing) Refresh(); });
    }

    private void Refresh()
    {
        status.Text = $"{client.State.ConnectionStatus}   ·   {client.State.Name}   {(client.State.SessionId is null ? "" : $"·   同期 {client.State.SyncStatus}   ·   通話 {media.Status}")}";
        if (!signedIn) return;
        home ??= new HomeView(context);
        room ??= new RoomView(context);
        if (previousSession != client.State.SessionId)
        {
            foreach (var item in itemWindows.Values.ToArray()) item.Close();
            itemWindows.Clear();
            homeOverlay?.Close();
            previousSession = client.State.SessionId;
            if (!Program.Arguments.Contains("--demo")) _ = SyncMedia();
            if (threeD.IsRunning) _ = threeD.StopAsync();
        }
        screen.Content = client.State.SessionId is null ? home : room;
        if (client.State.SessionId is null) home.Refresh(); else room.Refresh();
        overlayView?.Refresh();
        foreach (var window in itemWindows.Values.ToArray()) window.Refresh();
    }

    private async Task SyncMedia()
    {
        try { if (client.State.SessionId is { } sid) await media.ConnectAsync(sid); else await media.DisconnectAsync(); }
        catch (Exception e) { Notify("通話: " + e.Message); Program.Log(e.ToString()); }
    }

    private void MessageReceived(JsonObject message)
    {
        var type = J.Text(message, "t");
        if (type == "attention" && J.Text(message, "from") != client.State.SelfId) Notify("近くの人がアイテムに注目しています");
        if (type == "poke" && J.Text(message, "to") == client.State.SelfId) { Notify("つんつんされました"); System.Media.SystemSounds.Asterisk.Play(); }
        if (type == "hit" && J.Text(message, "to") == client.State.SelfId) Notify("ピコピコ！");
        if (type == "sound") NativeSounds.Play(J.Text(message, "id"));
    }

    private async Task ChangeMode(string mode)
    {
        if (switching) return;
        if (client.State.SessionId is null) { client.State.Mode = mode; client.State.Touch(); return; }
        switching = true;
        try
        {
            if (mode == "3d")
            {
                Notify("3D空間を準備しています…");
                var parent = IntPtr.Zero;
                if (OperatingSystem.IsWindows() && !Program.Arguments.Contains("--separate-3d"))
                {
                    room ??= new RoomView(context);
                    unitySurface = new UnitySurface();
                    unitySurface.ClientSizeChanged += (width, height) => _ = threeD.ResizeAsync(width, height);
                    room.SetThreeDSurface(unitySurface);
                    parent = await unitySurface.GetHandleAsync().WaitAsync(TimeSpan.FromSeconds(5));
                }
                await threeD.StartAsync(parent);
                unitySurface?.ResizePlayer(threeD.PlayerWindowHandle);
            }
            else { await threeD.StopAsync(); Activate(); }
            Refresh();
        }
        catch (Exception e) { room?.SetThreeDSurface(null); unitySurface = null; Notify(e.Message); Program.Log(e.ToString()); }
        finally { switching = false; }
    }

    private void OpenItem(string id)
    {
        if (id.StartsWith("item:")) id = id[5..];
        if (itemWindows.TryGetValue(id, out var existing)) { existing.WindowState = WindowState.Normal; existing.Activate(); return; }
        var window = new ItemWindow(context, id);
        itemWindows[id] = window;
        window.Activated += (_, _) =>
        {
            if (RoomWindowLayout.Free) return;
            foreach (var other in itemWindows.Values.Where(other => other != window).ToArray()) other.WindowState = WindowState.Minimized;
        };
        window.Closed += (_, _) => { itemWindows.Remove(id); _ = UpdateViewing(); };
        window.Show(this);
        _ = UpdateViewing();
    }

    private Task UpdateViewing() => client.State.SessionId is null ? Task.CompletedTask : client.SendRoomAsync(new { t = "viewing", keys = itemWindows.Keys.Select(id => "item:" + id).ToArray() });

    private void ShowProfile(string id) => new ProfileWindow(context, id).Show(this);

    private void ShowHome(string page)
    {
        if (page == "close") { homeOverlay?.Close(); Activate(); return; }
        home ??= new HomeView(context);
        if (client.State.SessionId is null) { home.Navigate(page); return; }
        if (homeOverlay is null)
        {
            overlayView = new HomeView(context);
            homeOverlay = new Window { Title = "Tonarium · ホーム", Width = Math.Max(1000, Width - 90), Height = Math.Max(650, Height - 80), MinWidth = 900, MinHeight = 600, WindowStartupLocation = WindowStartupLocation.CenterOwner, Content = overlayView };
            homeOverlay.Closed += (_, _) => { homeOverlay = null; overlayView = null; };
            homeOverlay.Show(this);
        }
        overlayView!.Navigate(page); homeOverlay.Activate();
    }

    public void Notify(string text)
    {
        if (!Dispatcher.UIThread.CheckAccess()) { Dispatcher.UIThread.Post(() => Notify(text)); return; }
        toastText.Text = text; toast.IsVisible = true;
        _ = Task.Delay(4500).ContinueWith(_ => Dispatcher.UIThread.Post(() => { if (toastText.Text == text) toast.IsVisible = false; }));
    }

    private async Task Shutdown()
    {
        closing = true;
        foreach (var window in itemWindows.Values.ToArray()) window.Close();
        homeOverlay?.Close();
        await threeD.DisposeAsync(); await media.DisposeAsync(); await client.DisposeAsync();
        Close();
    }

    private void LoadDemo()
    {
        client.State.Name = "あなた";
        client.State.Users = JsonNode.Parse("[{\"id\":\"demo1\",\"name\":\"あおい\",\"session\":\"lounge\",\"mode\":\"2d\",\"status\":\"online\"},{\"id\":\"demo2\",\"name\":\"りく\",\"session\":\"lounge\",\"mode\":\"3d\",\"status\":\"joinMe\"}]")!.AsArray();
        client.State.Sessions = JsonNode.Parse("[{\"id\":\"lounge\",\"name\":\"いつものラウンジ\",\"topic\":\"話したり、描いたり、同じ場所で。\",\"world\":\"cafe\",\"visibility\":\"public\"},{\"id\":\"work\",\"name\":\"もくもく部屋\",\"topic\":\"それぞれの作業を、いっしょに。\",\"world\":\"room\"}]")!.AsArray();
        client.State.Friends = new JsonArray("あおい", "りく");
        signedIn = true; Refresh();
        if (Program.Argument("--screenshot") is { } directory) _ = CaptureDemo(directory);
    }

    private async Task CaptureDemo(string directory)
    {
        await Task.Delay(1200); Directory.CreateDirectory(directory); Capture(Path.Combine(directory, "home.png"));
        client.State.SessionId = "lounge"; client.State.World = "cafe";
        client.State.Chats = JsonNode.Parse("[{\"id\":\"a\",\"from\":\"demo1\",\"fromName\":\"あおい\",\"text\":\"こんにちは！今日は何をしよう？\",\"scope\":\"all\",\"at\":1770000000000},{\"id\":\"b\",\"from\":\"demo2\",\"fromName\":\"りく\",\"text\":\"カフェでのんびりしてます ☕\",\"scope\":\"near\",\"at\":1770000000000}]")!.AsArray();
        Refresh(); await Task.Delay(700); Capture(Path.Combine(directory, "room.png"));
        await Shutdown();
    }

    private void Capture(string path)
    {
        var target = new RenderTargetBitmap(new PixelSize((int)Bounds.Width, (int)Bounds.Height), new Vector(96, 96));
        target.Render(this); target.Save(path); target.Dispose();
    }

    private async Task CaptureNative(string path)
    {
        await Task.Delay(350);
        var handle = TryGetPlatformHandle()?.Handle ?? IntPtr.Zero;
        if (handle == IntPtr.Zero) throw new InvalidOperationException("Native window handle is unavailable.");
        using var bitmap = new System.Drawing.Bitmap(Math.Max(1, (int)(Bounds.Width * RenderScaling)), Math.Max(1, (int)(Bounds.Height * RenderScaling)));
        using var graphics = System.Drawing.Graphics.FromImage(bitmap);
        var dc = graphics.GetHdc();
        try { if (!PrintWindow(handle, dc, 3)) throw new InvalidOperationException("Could not capture the native app window."); }
        finally { graphics.ReleaseHdc(dc); }
        bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);

    private async Task RunSmoke(string directory)
    {
        try
        {
            Directory.CreateDirectory(directory);
            File.Delete(Path.Combine(directory, "error.txt"));
            await Task.Delay(1800); Capture(Path.Combine(directory, "home.png"));
            var sid = Program.Argument("--session") ?? client.State.Sessions.FirstOrDefault()?["id"]?.ToString();
            if (sid is not null) { await client.JoinAsync(sid); await Task.Delay(3000); Capture(Path.Combine(directory, "room.png")); }
            if (sid is not null && Program.Arguments.Contains("--smoke-3d"))
            {
                await ChangeMode("3d"); await Task.Delay(2500);
                if (!threeD.IsRunning || threeD.PlayerWindowHandle == IntPtr.Zero) throw new InvalidOperationException("Unity の埋め込み起動を確認できませんでした");
                await CaptureNative(Path.Combine(directory, "embedded.png"));
                Width = 1100; Height = 720; await Task.Delay(500);
                await CaptureNative(Path.Combine(directory, "embedded-resized.png"));
                await File.WriteAllTextAsync(Path.Combine(directory, "embedded.json"), new JsonObject { ["running"] = threeD.IsRunning, ["embedded"] = (unitySurface?.Handle ?? IntPtr.Zero) != IntPtr.Zero, ["mode"] = client.State.Mode, ["playerWindow"] = threeD.PlayerWindowHandle.ToInt64(), ["resized"] = true }.ToJsonString());
                await ChangeMode("2d"); await Task.Delay(300);
                if (threeD.IsRunning || client.State.Mode != "2d") throw new InvalidOperationException("2D への復帰を確認できませんでした");
                Capture(Path.Combine(directory, "returned-2d.png"));
            }
            await File.WriteAllTextAsync(Path.Combine(directory, "result.json"), new JsonObject { ["passed"] = true, ["connected"] = client.State.Connected, ["sync"] = client.State.SyncStatus, ["session"] = client.State.SessionId, ["users"] = client.State.Users.Count, ["items"] = client.State.Items.Count, ["media"] = media.Status }.ToJsonString());
        }
        catch (Exception e) { Environment.ExitCode = 1; Program.Log(e.ToString()); await File.WriteAllTextAsync(Path.Combine(directory, "error.txt"), e.ToString()); await File.WriteAllTextAsync(Path.Combine(directory, "result.json"), new JsonObject { ["passed"] = false, ["error"] = e.Message }.ToJsonString()); }
        finally { await Shutdown(); }
    }
}
