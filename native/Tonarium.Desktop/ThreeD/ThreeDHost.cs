using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia.Threading;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;

namespace Tonarium.Desktop.ThreeD;

public sealed partial class ThreeDHost : IAsyncDisposable
{
    private readonly TonariumClient client;
    private readonly SemaphoreSlim lifecycle = new(1);
    private readonly SemaphoreSlim writing = new(1);
    private CancellationTokenSource? lifetime;
    private TcpListener? listener;
    private TcpClient? connection;
    private StreamWriter? writer;
    private Process? player;
    private TaskCompletionSource? ready;
    private bool stopping;
    private INativeMedia? media;
    private bool mediaAttached;
    private DispatcherTimer? presentationTimer;
    private string presentationSignature = "";
    public event Action? ReturnedTo2D;
    public event Action<string>? ItemRequested;
    public event Action<bool>? InputStateChanged;
    public bool UsesRelativePointer { get; private set; }
    public event Action? HomeRequested;
    public event Action? ChatRequested;
    public event Action? SidePanelsToggleRequested;
    public bool IsRunning => player is { HasExited: false };
    public string? PlayerPath { get; private set; }
    public string? LastError { get; private set; }

    public ThreeDHost(TonariumClient client)
    {
        this.client = client;
        client.MessageReceived += ForwardMessage;
    }

    public void AttachMedia(INativeMedia nativeMedia)
    {
        if (mediaAttached && media is not null) media.VideoFrameJpeg -= ForwardVideoFrame;
        media = nativeMedia;
        mediaAttached = IsRunning && !stopping;
        if (mediaAttached) media.VideoFrameJpeg += ForwardVideoFrame;
    }

    public async Task StartAsync(IntPtr parentWindow = default)
    {
        await lifecycle.WaitAsync();
        try
        {
            if (IsRunning) return;
            if (client.State.SessionId is null) throw new InvalidOperationException("セッションに参加してから 3D に入ってください。");
            stopping = false; LastError = null;
            PlayerPath = FindPlayer();
            if (PlayerPath is null)
            {
                await BuildPlayerAsync();
                PlayerPath = FindPlayer();
            }
            if (PlayerPath is null) throw new FileNotFoundException("Unity プレイヤーがありません。native/build-unity.ps1 を実行してください。");
            lifetime = new CancellationTokenSource();
            ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(1);
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var info = new ProcessStartInfo(PlayerPath) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(PlayerPath)! };
            info.ArgumentList.Add("--tonarium-port"); info.ArgumentList.Add(port.ToString());
            info.ArgumentList.Add("-screen-fullscreen"); info.ArgumentList.Add("0");
            info.ArgumentList.Add("-screen-width"); info.ArgumentList.Add("1280");
            info.ArgumentList.Add("-screen-height"); info.ArgumentList.Add("800");
            var log = Path.Combine(DesktopInstance.DataDirectory, "unity-player.log");
            Directory.CreateDirectory(Path.GetDirectoryName(log)!);
            info.ArgumentList.Add("-logFile"); info.ArgumentList.Add(log);
            if (parentWindow != IntPtr.Zero)
            {
                info.ArgumentList.Add("-parentHWND"); info.ArgumentList.Add(parentWindow.ToInt64().ToString()); info.ArgumentList.Add("delayed");
                info.ArgumentList.Add("--tonarium-embedded");
            }
            player = Process.Start(info) ?? throw new InvalidOperationException("Unity プレイヤーを起動できませんでした。");
            player.EnableRaisingEvents = true;
            player.Exited += PlayerExited;
            _ = ReceiveAsync(lifetime.Token);
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(40));
            if (parentWindow != IntPtr.Zero)
            {
                await EmbedPlayerAsync(parentWindow);
                await SendAsync(new { t = "pointerWindow", hwnd = PlayerWindowHandle.ToInt64() });
            }
            await client.SendRoomAsync(new { t = "mode", mode = "3d" });
            if (media is not null) { media.VideoFrameJpeg += ForwardVideoFrame; mediaAttached = true; }
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                presentationTimer = new DispatcherTimer { Interval=TimeSpan.FromMilliseconds(100) };
                presentationTimer.Tick += (_,_) => ForwardPresentation();
                presentationTimer.Start(); ForwardPresentation();
            });
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            await ClosePlayerAsync();
            throw;
        }
        finally { lifecycle.Release(); }
    }

    private async Task ReceiveAsync(CancellationToken ct)
    {
        try
        {
            connection = await listener!.AcceptTcpClientAsync(ct);
            connection.NoDelay = true;
            listener.Stop();
            writer = new StreamWriter(connection.GetStream(), new UTF8Encoding(false)) { AutoFlush = true };
            using var reader = new StreamReader(connection.GetStream(), Encoding.UTF8);
            while (!ct.IsCancellationRequested)
            {
                string? line = await reader.ReadLineAsync(ct);
                if (line is null) break;
                if (line.Length > 16 * 1024 * 1024) throw new IOException("Unity message is too large.");
                if (JsonNode.Parse(line) is not JsonObject message) continue;
                switch (message["t"]?.ToString())
                {
                    case "ready":
                        await SendSnapshotAsync();
                        ready?.TrySetResult();
                        break;
                    case "room" when message["message"] is JsonObject room:
                        if (room["action"] is JsonObject action && action["a"]?.ToString() == "camLive" &&
                            action["on"]?.GetValue<bool>() == true && media?.Connected != true)
                        {
                            await SendAsync(new { t = "notice", text = "通話に接続していないので配信できません" });
                            break;
                        }
                        await client.SendRoomAsync(room);
                        break;
                    case "home" when message["message"] is JsonObject home:
                        await client.SendAsync(home);
                        break;
                    case "cameraFrame" when media is NativeMedia native:
                        if (message["id"]?.ToString() is { } cameraId && message["jpeg"]?.ToString() is { Length: > 0 and < 2097152 } encoded)
                            native.SubmitCameraFrame(cameraId, Convert.FromBase64String(encoded));
                        break;
                    case "return2d":
                        _ = StopAsync();
                        return;
                    case "inputState":
                        UsesRelativePointer = message["relativeInput"]?.GetValue<bool>() == true;
                        await Dispatcher.UIThread.InvokeAsync(() => InputStateChanged?.Invoke(message["locked"]?.GetValue<bool>() == true));
                        break;
                    case "openHome":
                        await Dispatcher.UIThread.InvokeAsync(() => HomeRequested?.Invoke());
                        break;
                    case "focusChat":
                        await Dispatcher.UIThread.InvokeAsync(() => ChatRequested?.Invoke());
                        break;
                    case "toggleSidePanels":
                        await Dispatcher.UIThread.InvokeAsync(() => SidePanelsToggleRequested?.Invoke());
                        break;
                    case "openItem":
                        if (message["id"]?.ToString() is { } itemId)
                            await Dispatcher.UIThread.InvokeAsync(() => ItemRequested?.Invoke(itemId));
                        break;
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (!stopping) { LastError = ex.Message; ready?.TrySetException(ex); }
        }
        finally { if (!stopping && !ct.IsCancellationRequested) _ = StopAsync(); }
    }

    private async Task SendSnapshotAsync()
    {
        var snapshot = await Dispatcher.UIThread.InvokeAsync(() =>
        {
            var s = client.State;
            return new JsonObject
            {
                ["t"] = "snapshot", ["selfId"] = s.SelfId, ["name"] = s.Name,
                ["serverUrl"] = s.ServerUrl, ["sessionId"] = s.SessionId, ["world"] = s.World,
                ["users"] = s.Users.DeepClone(), ["avatars"] = s.Avatars.DeepClone(),
                ["items"] = s.Items.DeepClone(), ["presence"] = s.Presence.DeepClone(),
                ["chats"] = s.Chats.DeepClone(), ["game"] = s.Game.DeepClone(),
                ["now"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + s.ServerOffset
            };
        });
        await SendAsync(snapshot);
    }

    private async void ForwardMessage(JsonObject message)
    {
        if (writer is null || stopping) return;
        try
        {
            if (message["sid"] is { } sid && sid.ToString() != client.State.SessionId) return;
            if (message["t"]?.ToString() == "sessionSnapshot") await SendSnapshotAsync();
            else await SendAsync(message.DeepClone());
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException) { }
    }

    private async Task SendAsync(object message)
    {
        string json = message is JsonNode node ? node.ToJsonString() : JsonSerializer.Serialize(message);
        await writing.WaitAsync();
        try { if (writer is not null) await writer.WriteLineAsync(json); }
        finally { writing.Release(); }
    }

    private async void ForwardPresentation()
    {
        if(!IsRunning||stopping||writer is null)return;
        var users=(JsonArray)client.State.Users.DeepClone();
        foreach(var user in users.OfType<JsonObject>())
        {
            var id=J.Text(user,"id");
            if(media is NativeMedia native)user["speaking"]=native.IsSpeaking(id);
            if(client.State.Presence[id] is JsonObject presence)
                foreach(var pair in presence)user[pair.Key]=pair.Value?.DeepClone();
        }
        var signature=users.ToJsonString();if(signature==presentationSignature)return;
        presentationSignature=signature;
        try { await SendAsync(new JsonObject { ["t"]="users",["list"]=users }); }
        catch(Exception error) when(error is IOException or ObjectDisposedException or OperationCanceledException) { }
    }

    public Task ReleaseInputAsync()=>writer is null?Task.CompletedTask:SendAsync(new {t="releaseInput"});
    public Task SetOpenItemsAsync(IEnumerable<string> ids) => writer is null ? Task.CompletedTask : SendAsync(new { t = "nativeItems", ids = ids.ToArray() });

    private async void ForwardVideoFrame(string identity, byte[] jpeg)
    {
        if (stopping || writer is null) return;
        try { await SendAsync(new { t = "videoFrame", identity, jpeg = Convert.ToBase64String(jpeg) }); }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException) { }
    }

    public async Task TeleportAsync(double x, double z, double ry)
    {
        await SendAsync(new { t = "teleport", x, z, ry });
        await client.SendRoomAsync(new { t = "avatar", s = new { x, z, ry, y = 0 } });
    }

    public Task ResizeAsync(int width, int height, double scale = 1) => SendAsync(new { t = "resize", width = Math.Clamp(width, 160, 8192), height = Math.Clamp(height, 160, 8192), scale });

    public async Task StopAsync()
    {
        await lifecycle.WaitAsync();
        try
        {
            bool wasRunning = player is not null || lifetime is not null;
            stopping = true;
            await ClosePlayerAsync();
            if (client.State.SessionId is not null) await client.SendRoomAsync(new { t = "mode", mode = "2d" });
            if (wasRunning) await Dispatcher.UIThread.InvokeAsync(() => ReturnedTo2D?.Invoke());
        }
        finally { lifecycle.Release(); }
    }

    private async Task ClosePlayerAsync()
    {
        stopping = true;
        await Dispatcher.UIThread.InvokeAsync(()=> { presentationTimer?.Stop();presentationTimer=null;presentationSignature=""; });
        if (mediaAttached && media is not null) { media.VideoFrameJpeg -= ForwardVideoFrame; mediaAttached = false; }
        // Unityから先に終了した場合も、破棄済みの接続で2Dへの復帰を止めない。
        if (writer is not null)
        {
            try { await SendAsync(new { t = "shutdown" }); }
            catch (Exception error) when (error is IOException or ObjectDisposedException) { }
        }
        lifetime?.Cancel(); listener?.Stop(); connection?.Dispose(); writer = null;
        if (player is { HasExited: false })
        {
            try { await player.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
            catch (TimeoutException) { player.Kill(entireProcessTree: true); await player.WaitForExitAsync(); }
        }
        if (player is not null) { player.Exited -= PlayerExited; player.Dispose(); player = null; }
        PlayerWindowHandle = IntPtr.Zero;
        lifetime?.Dispose(); lifetime = null; connection = null; listener = null;
    }

    private void PlayerExited(object? sender, EventArgs e)
    {
        ready?.TrySetException(new IOException("Unity が終了しました。%LOCALAPPDATA%/Tonarium/unity-player.log を確認してください。"));
        if (!stopping) _ = StopAsync();
    }

    private static string? FindPlayer()
    {
        string? configured = Environment.GetEnvironmentVariable("TONARIUM_UNITY_PLAYER");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return Path.GetFullPath(configured);
        foreach (var root in Roots())
            foreach (var relative in new[] { "Tonarium3D.exe", "unity/Tonarium3D.exe", "build/unity/Tonarium3D.exe", "native/build/unity/Tonarium3D.exe" })
            {
                var candidate = Path.Combine(root, relative);
                if (File.Exists(candidate)) return candidate;
            }
        return null;
    }

    private static IEnumerable<string> Roots()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string start in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory })
            for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent)
                if (seen.Add(directory.FullName)) yield return directory.FullName;
    }

    private static async Task BuildPlayerAsync()
    {
        string? project = Roots().SelectMany(r => new[] { Path.Combine(r, "native", "Tonarium.Unity"), Path.Combine(r, "Tonarium.Unity") })
            .FirstOrDefault(p => File.Exists(Path.Combine(p, "ProjectSettings", "ProjectVersion.txt")));
        if (project is null) throw new FileNotFoundException("Tonarium 3D が見つかりません。TONARIUM_UNITY_PLAYER にプレイヤーのパスを設定してください。");
        var editor = Environment.GetEnvironmentVariable("TONARIUM_UNITY_EDITOR");
        if (string.IsNullOrWhiteSpace(editor))
        {
            string editorRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Unity", "Hub", "Editor");
            editor = Directory.Exists(editorRoot) ? Directory.GetDirectories(editorRoot).OrderBy(p => p.Contains("2022.3") ? 0 : 1).ThenByDescending(p => p)
                .Select(p => Path.Combine(p, "Editor", "Unity.exe")).FirstOrDefault(File.Exists) : null;
        }
        if (editor is null) throw new FileNotFoundException("Unity Editor がありません。Unity Hub で Unity 2022.3 と Windows Build Support をインストールしてください。");
        string log = Path.Combine(project, "build.log");
        var info = new ProcessStartInfo(editor) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        foreach (string arg in new[] { "-batchmode", "-nographics", "-quit", "-projectPath", project, "-executeMethod", "Tonarium.UnityClient.Editor.WindowsBuild.Build", "-logFile", log }) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new IOException("Unity のビルドを起動できませんでした。");
        await process.WaitForExitAsync();
        if (process.ExitCode != 0) throw new IOException("Unity のビルドに失敗しました。ログ: " + log);
    }

    public async ValueTask DisposeAsync()
    {
        client.MessageReceived -= ForwardMessage;
        await StopAsync();
    }
}
