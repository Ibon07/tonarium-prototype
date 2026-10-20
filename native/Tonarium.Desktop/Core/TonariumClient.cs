using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia.Threading;

namespace Tonarium.Desktop.Core;

/// <summary>Native social WebSocket and authenticated KokoSync room connection.</summary>
public sealed class TonariumClient : IAsyncDisposable
{
    private readonly SemaphoreSlim homeSend = new(1);
    private readonly SemaphoreSlim roomSend = new(1);
    private readonly string settingsPath;
    private readonly bool persistSettings;
    private CancellationTokenSource? lifetime;
    private CancellationTokenSource? roomLifetime;
    private ClientWebSocket? home;
    private KokoSync.Client? room;
    private Task? homeLoop;
    private JsonObject? syncConfig;
    private string? requestId;
    private long sendSequence, positionSequence, receivedSequence;
    private readonly Dictionary<string, long> positions = new();
    private readonly Queue<JsonObject> pending = new();
    private int roomGeneration;
    private bool roomReady;
    private static readonly HashSet<string> RoomTypes = new(StringComparer.Ordinal)
    {
        "peerOperation", "sync", "mode", "status", "follow", "dropFollowers", "place2d", "displayMove", "chat",
        "avatar", "viewing", "poke", "sound", "liveRequest", "viewLive", "itemCreate", "attention", "broadcast",
        "world", "gameStart", "gameStep", "gameFell", "itemRemove", "itemMove", "itemAction", "hit"
    };
    public ClientState State { get; }
    public event Action<JsonObject>? MessageReceived;

    public TonariumClient(ClientState? state = null, bool persistSettings = true)
    {
        State = state ?? new ClientState();
        this.persistSettings = persistSettings;
        settingsPath = Path.Combine(DesktopInstance.DataDirectory, "desktop.json");
        try
        {
            if (persistSettings && JsonNode.Parse(File.ReadAllText(settingsPath)) is JsonObject saved)
            {
                State.Name = Text(saved, "name", State.Name);
                State.SelfId = Text(saved, "selfId", State.SelfId);
                State.ServerUrl = Text(saved, "server", State.ServerUrl);
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }
        if (persistSettings && DesktopInstance.Number > 1 && !File.Exists(settingsPath))
        {
            // 追加ウィンドウは接続先だけ引き継ぎ、別のユーザーID・名前で参加する。
            try
            {
                if (JsonNode.Parse(File.ReadAllText(Path.Combine(DesktopInstance.RootDirectory, "desktop.json"))) is JsonObject primary)
                    State.ServerUrl = Text(primary, "server", State.ServerUrl);
            }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }
        }
    }

    public async Task ConnectAsync(string url, string name)
    {
        await DisconnectAsync();
        if (!Uri.TryCreate(url.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var endpoint) ||
            endpoint.Scheme is not ("http" or "https" or "ws" or "wss"))
            throw new ArgumentException("接続先を http:// または https:// から入力してください。");
        var builder = new UriBuilder(endpoint) { Scheme = endpoint.Scheme is "https" or "wss" ? "https" : "http" };
        State.ServerUrl = builder.Uri.ToString().TrimEnd('/');
        State.Name = string.IsNullOrWhiteSpace(name) ? "ゲスト" : name.Trim()[..Math.Min(24, name.Trim().Length)];
        Persist();
        lifetime = new CancellationTokenSource();
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        homeLoop = RunHomeAsync(lifetime.Token, ready);
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(20));
    }

    private async Task RunHomeAsync(CancellationToken ct, TaskCompletionSource ready)
    {
        var retries = 0;
        while (!ct.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            home = socket;
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
            try
            {
                await UiAsync(() => { State.ConnectionStatus = retries == 0 ? "接続しています…" : "再接続しています…"; State.LastError = null; });
                var endpoint = new UriBuilder(State.ServerUrl) { Scheme = State.ServerUrl.StartsWith("https:", StringComparison.Ordinal) ? "wss" : "ws", Path = "/ws" };
                await socket.ConnectAsync(endpoint.Uri, ct);
                await UiAsync(() => { State.Connected = true; State.ConnectionStatus = "接続済み"; });
                await SendHomeAsync(new JsonObject { ["t"] = "hello", ["id"] = State.SelfId, ["name"] = State.Name }, ct);
                if (State.SessionId is { } sid)
                {
                    await SendHomeAsync(new JsonObject { ["t"] = "join", ["sid"] = sid }, ct);
                    await PrepareSyncAsync();
                }
                retries = 0;
                ready.TrySetResult();
                var buffer = new byte[64 * 1024];
                while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    using var content = new MemoryStream();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(buffer, ct);
                        if (result.MessageType == WebSocketMessageType.Close) throw new IOException("ホームとの接続が終了しました。");
                        if (content.Length + result.Count > SessionPacket.MaxBytes) throw new IOException("ホームのデータが大きすぎます。");
                        content.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);
                    if (JsonNode.Parse(content.ToArray()) is JsonObject message) await ReceiveHomeAsync(message);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                await UiAsync(() => { State.LastError = Friendly(ex); State.ConnectionStatus = "再接続を待っています"; });
                if (!ready.Task.IsCompleted) ready.TrySetException(new IOException(Friendly(ex)));
            }
            finally
            {
                if (ReferenceEquals(home, socket)) home = null;
                await StopRoomAsync();
                await UiAsync(() => State.Connected = false);
            }
            try { await Task.Delay(Math.Min(5000, 500 * (1 << Math.Min(retries++, 4))), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    public Task SendAsync(object msg)
    {
        var node = AsObject(msg);
        return RoomTypes.Contains(Text(node, "t")) ? SendRoomAsync(node) : SendHomeAsync(node, lifetime?.Token ?? CancellationToken.None);
    }

    private async Task SendHomeAsync(JsonObject message, CancellationToken ct)
    {
        var socket = home;
        if (socket?.State != WebSocketState.Open) throw new IOException("サーバーに接続してから操作してください。");
        var bytes = Encoding.UTF8.GetBytes(message.ToJsonString());
        await homeSend.WaitAsync(ct);
        try { await socket.SendAsync(bytes, WebSocketMessageType.Text, true, ct); }
        finally { homeSend.Release(); }
    }

    public async Task JoinAsync(string sid)
    {
        await StopRoomAsync();
        await SendHomeAsync(new JsonObject { ["t"] = "join", ["sid"] = sid }, lifetime?.Token ?? CancellationToken.None);
        await UiAsync(() => { State.SessionId = sid; State.Mode = "2d"; ResetRoomState(); });
        await PrepareSyncAsync();
    }

    public async Task LeaveAsync()
    {
        if (State.Connected) await SendHomeAsync(new JsonObject { ["t"] = "leave" }, lifetime?.Token ?? CancellationToken.None);
        await StopRoomAsync();
        await UiAsync(() => { State.SessionId = null; State.Mode = "2d"; ResetRoomState(); });
    }

    private void ResetRoomState()
    {
        State.Items = new(); State.Avatars = new(); State.Presence = new(); State.Chats = new(); State.Game = new();
        State.Broadcast = false; State.MicOn = false; State.Sharing = false; State.WorldPending = null;
        State.World = State.SessionInfo[State.SessionId ?? ""] is JsonObject info ? Text(info, "world", "room") : "room";
    }

    private async Task PrepareSyncAsync()
    {
        if (!State.Connected || State.SessionId is null) return;
        requestId = Guid.NewGuid().ToString();
        await UiAsync(() => State.SyncStatus = "connecting");
        // Native SDK relay path: server delivers interoperable positions and canvas deltas.
        await SendHomeAsync(new JsonObject { ["t"] = "prepareSync", ["requestId"] = requestId, ["peerPositions"] = false, ["peerDelivery"] = false }, lifetime?.Token ?? CancellationToken.None);
    }

    private async Task ReceiveHomeAsync(JsonObject message)
    {
        switch (Text(message, "t"))
        {
            case "syncConfig":
                if (Text(message, "requestId") == requestId && message["config"] is JsonObject config)
                    _ = ConfigureRoomAsync((JsonObject)config.DeepClone());
                return;
            case "syncError":
                if (Text(message, "requestId") == requestId)
                {
                    await UiAsync(() => { State.SyncStatus = "unavailable"; State.LastError = Text(message, "error"); });
                    _ = RetryRoomAsync(roomGeneration);
                }
                return;
            case "syncReset":
                if (Text(message, "sid") == State.SessionId) _ = RetryRoomAsync(roomGeneration);
                return;
        }
        await UiAsync(() => ApplyMessage(message), false);
    }

    private async Task ConfigureRoomAsync(JsonObject config)
    {
        if (Text(config, "sid") != State.SessionId) return;
        await StopRoomAsync(clearPending: false);
        await UiAsync(() => State.SyncStatus = "connecting");
        var generation = roomGeneration;
        var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime?.Token ?? CancellationToken.None);
        roomLifetime = cancellation;
        var ct = cancellation.Token;
        try
        {
            var endpoint = new UriBuilder(State.ServerUrl)
            {
                Scheme = State.ServerUrl.StartsWith("https:", StringComparison.Ordinal) ? "wss" : "ws",
                Path = "/sync/ws", Query = "token=" + Uri.EscapeDataString(Text(config, "token"))
            };
            var connection = await KokoSync.Client.ConnectWebSocketAsync(endpoint.Uri, ct,
                headers: new Dictionary<string, string> { ["Origin"] = State.ServerUrl });
            if (generation != roomGeneration) { await connection.DisposeAsync(); return; }
            room = connection; syncConfig = config;
            sendSequence = positionSequence = receivedSequence = 0; positions.Clear();
            await connection.JoinAsync(Text(config, "room"), Text(config, "peer"), ct: ct);
            _ = ReadRoomAsync(connection, config, generation, ct);
            await SendRoomAsync(new JsonObject { ["t"] = "sync" });
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (generation != roomGeneration) return;
            await UiAsync(() => { State.SyncStatus = "unavailable"; State.LastError = Friendly(ex); });
            _ = RetryRoomAsync(generation);
        }
    }

    private async Task ReadRoomAsync(KokoSync.Client connection, JsonObject config, int generation, CancellationToken ct)
    {
        try
        {
            await foreach (var frame in connection.Events(ct))
            {
                if (generation != roomGeneration) break;
                var type = frame.GetValueOrDefault("type") as string;
                var peer = frame.GetValueOrDefault("peer") as string;
                if (peer != Text(config, "server")) continue;
                if (type == "blob_open")
                {
                    if (KokoSync.Client.Number(frame, "size") > SessionPacket.MaxBytes)
                    { await connection.CancelBlobAsync((string)frame["transfer"]!, ct); continue; }
                    // Drain the encrypted payload in stream order. The SDK consumes blob chunks independently.
                    await ReceiveBlobAsync(connection, frame, config, generation, ct);
                }
                else if (frame.GetValueOrDefault("value") is Dictionary<string, object?> packet &&
                    (type == "message" && frame.GetValueOrDefault("topic") as string == SessionPacket.Topic ||
                     type == "latest" && (frame.GetValueOrDefault("key") as string)?.StartsWith(SessionPacket.Topic + ":", StringComparison.Ordinal) == true))
                    await ReceivePacketAsync(packet, config, type == "latest", generation);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
        catch (Exception ex)
        {
            if (generation == roomGeneration) await UiAsync(() => State.LastError = Friendly(ex));
        }
        if (generation == roomGeneration && !ct.IsCancellationRequested) _ = RetryRoomAsync(generation);
    }

    private async Task ReceiveBlobAsync(KokoSync.Client connection, Dictionary<string, object?> frame, JsonObject config, int generation, CancellationToken ct)
    {
        try
        {
            using var stream = new MemoryStream();
            await connection.ReceiveBlobAsync(frame, stream, ct);
            await ReceivePacketAsync(KokoSync.Wire.Decode(stream.ToArray(), SessionPacket.MaxBytes), config, false, generation);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (generation == roomGeneration)
            { await UiAsync(() => State.LastError = Friendly(ex)); _ = RetryRoomAsync(generation); }
        }
    }

    private async Task ReceivePacketAsync(Dictionary<string, object?> packet, JsonObject config, bool latest, int generation)
    {
        if (generation != roomGeneration || packet.GetValueOrDefault("grant") as string != Text(config, "token")) return;
        var result = SessionPacket.Open(Convert.FromBase64String(Text(config, "key")), Text(config, "token"), latest ? "server-position" : "server", packet);
        var message = result.Value;
        if (latest)
        {
            var id = Text(message, "id");
            if (Text(message, "sid") != State.SessionId || positions.GetValueOrDefault(id) >= result.Sequence) return;
            positions[id] = result.Sequence;
            await UiAsync(() => ApplyMessage(message), false);
            return;
        }
        if (result.Sequence <= receivedSequence) return;
        receivedSequence = result.Sequence;
        if (Text(message, "kind") == "snapshot" && message["snapshot"] is JsonObject snapshot && Text(snapshot, "sid") == State.SessionId)
        {
            await UiAsync(() => ApplySessionSnapshot(snapshot), false);
            var first = !roomReady;
            roomReady = true;
            await UiAsync(() => { State.SyncStatus = "connected"; State.LastError = null; });
            if (first)
            {
                await SendRoomAsync(new JsonObject { ["t"] = "mode", ["mode"] = State.Mode });
                await SendRoomAsync(new JsonObject { ["t"] = "status", ["micOn"] = State.MicOn, ["sharing"] = State.Sharing });
                JsonObject[] buffered;
                lock (pending) { buffered = pending.ToArray(); pending.Clear(); }
                foreach (var item in buffered) await SendRoomAsync(item);
            }
        }
        else if (Text(message, "kind") == "message" && message["message"] is JsonObject nested)
            await UiAsync(() => ApplyMessage(nested), false);
    }

    public async Task SendRoomAsync(object msg)
    {
        var message = AsObject(msg);
        if (State.SessionId is null) return;
        var type = Text(message, "t");
        if (type == "mode") await UiAsync(() => State.Mode = Text(message, "mode", "2d"));
        if (type == "status") await UiAsync(() => { State.MicOn = Boolean(message, "micOn"); State.Sharing = Boolean(message, "sharing"); });
        if (!roomReady && type != "sync")
        {
            if (type is "avatar" or "viewing" or "mode" or "status") return;
            lock (pending)
            {
                if (pending.Count >= 128) throw new IOException("同期を待っています。接続後にもう一度操作してください。");
                pending.Enqueue((JsonObject)message.DeepClone());
            }
            return;
        }
        var connection = room;
        var config = syncConfig;
        var generation = roomGeneration;
        if (connection is null || config is null) return;
        var ct = roomLifetime?.Token ?? CancellationToken.None;
        await roomSend.WaitAsync(ct);
        try
        {
            if (generation != roomGeneration) return;
            // サーバーは描いた本人へ差分を返さないため、Web版と同じく手元にも適用する。
            if (type == "itemAction" && message["action"] is JsonObject action &&
                Text(action, "a") is "strokeStart" or "strokeAdd" or "canvasClear")
            {
                var local = (JsonObject)message.DeepClone();
                local["sid"] = State.SessionId; local["by"] = State.SelfId;
                await UiAsync(() => ApplyMessage(local), false);
            }
            var position = type == "avatar";
            var sequence = position ? ++positionSequence : ++sendSequence;
            var packet = SessionPacket.Seal(Convert.FromBase64String(Text(config, "key")), Text(config, "token"), position ? "client-position" : "client", sequence, message);
            if (position) await connection.LatestAsync(SessionPacket.Topic, packet, (ulong)sequence, ct);
            else
            {
                var encoded = KokoSync.Wire.Encode(packet, SessionPacket.MaxBytes);
                if (encoded.Length > SessionPacket.BlobThreshold)
                {
                    using var stream = new MemoryStream(encoded, false);
                    await connection.SendBlobAsync(Text(config, "server"), stream, (ulong)encoded.Length, ct);
                }
                else await connection.MessageAsync(SessionPacket.Topic, packet, ct);
            }
        }
        finally { roomSend.Release(); }
    }

    private async Task RetryRoomAsync(int generation)
    {
        try
        {
            await Task.Delay(1500, lifetime?.Token ?? CancellationToken.None);
            if (generation != roomGeneration || !State.Connected || State.SessionId is null) return;
            await StopRoomAsync();
            await PrepareSyncAsync();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { await UiAsync(() => State.LastError = Friendly(ex)); }
    }

    private async Task StopRoomAsync(bool clearPending = true)
    {
        roomGeneration++;
        roomReady = false;
        var cancellation = roomLifetime; roomLifetime = null;
        cancellation?.Cancel();
        var old = room; room = null; syncConfig = null;
        if (clearPending) lock (pending) pending.Clear();
        if (old is not null) { try { await old.DisposeAsync(); } catch (Exception) { } }
        cancellation?.Dispose();
        await UiAsync(() => State.SyncStatus = "off");
    }

    public async Task DisconnectAsync()
    {
        var cancellation = lifetime; lifetime = null;
        cancellation?.Cancel();
        home?.Abort();
        if (homeLoop is not null) { try { await homeLoop; } catch (Exception) { } homeLoop = null; }
        await StopRoomAsync();
        cancellation?.Dispose();
        await UiAsync(() => { State.Connected = false; State.ConnectionStatus = "未接続"; State.SessionId = null; ResetRoomState(); });
    }

    public void ApplySessionSnapshot(JsonObject snapshot)
    {
        State.Chats = Array(snapshot, "chats");
        State.Avatars = Object(snapshot, "avatars");
        State.Presence = Object(snapshot, "presence");
        State.Items = new JsonObject();
        foreach (var item in Array(snapshot, "items").OfType<JsonObject>()) State.Items[Text(item, "id")] = item.DeepClone();
        State.Broadcast = Boolean(snapshot, "broadcast");
        State.World = Text(snapshot, "world", "room");
        State.Game = Object(snapshot, "game");
        State.ServerOffset = Number(snapshot, "now") - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        MessageReceived?.Invoke(new JsonObject { ["t"] = "sessionSnapshot", ["s"] = snapshot.DeepClone() });
        State.Touch();
    }

    /// <summary>All incoming protocol messages are applied on the UI thread.</summary>
    public void ApplyMessage(JsonObject message)
    {
        var type = Text(message, "t");
        if (message["sid"] is not null && Text(message, "sid") != State.SessionId) return;
        switch (type)
        {
            case "snapshot":
                State.Snapshot = Object(message, "s");
                State.Users = Array(State.Snapshot, "users"); State.Friends = Array(State.Snapshot, "friends");
                State.Groups = Array(State.Snapshot, "groups"); State.Events = Array(State.Snapshot, "events");
                State.Sessions = Array(Object(State.Snapshot, "guild"), "sessions"); State.SessionInfo = Object(State.Snapshot, "sessions");
                State.ServerOffset = Number(State.Snapshot, "now") - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); break;
            case "users": State.Users = Array(message, "list"); break;
            case "sessions": State.Sessions = Array(message, "list"); break;
            case "friends": State.Friends = Array(message, "names"); break;
            case "groups": State.Groups = Array(message, "list"); break;
            case "events": State.Events = Array(message, "list"); break;
            case "sessionInfo": State.SessionInfo = Object(message, "sessions"); break;
            case "inbox":
                State.Conversations = Object(message, "convs"); State.Reads = Object(message, "reads"); State.People = Array(message, "people");
                State.Watching = Array(message, "watching"); State.RecentStatus = Array(message, "recentStatus");
                State.LastSeen ??= message["lastSeen"] is null ? null : Number(message, "lastSeen"); break;
            case "people": State.People = Array(message, "list"); break;
            case "watching": State.Watching = Array(message, "names"); State.RecentStatus = Array(message, "recentStatus"); break;
            case "msg":
                var conv = Text(message, "conv");
                if (State.Conversations[conv] is not JsonArray list) { list = new JsonArray(); State.Conversations[conv] = list; }
                Upsert(list, Object(message, "m"), 300); break;
            case "read":
                var key = Text(message, "conv"); State.Reads[key] = Math.Max(State.Reads[key]?.GetValue<long>() ?? 0, Number(message, "at")); break;
            case "presence": State.Presence = Object(message, "all"); break;
            case "avatar": State.Avatars[Text(message, "id")] = message["s"]?.DeepClone(); break;
            case "avatarRemove": State.Avatars.Remove(Text(message, "id")); break;
            case "item":
                var item = Object(message, "item"); State.Items[Text(item, "id")] = item; break;
            case "itemRemove": State.Items.Remove(Text(message, "id")); break;
            case "itemAction": ApplyItemDelta(Text(message, "id"), Object(message, "action"), Text(message, "by")); break;
            case "chat": Upsert(State.Chats, Object(message, "m"), 500); break;
            case "broadcast": State.Broadcast = Boolean(message, "on"); break;
            case "worldPending": State.WorldPending = (JsonObject)message.DeepClone(); break;
            case "world": State.World = Text(message, "world", "room"); State.WorldPending = null; break;
            case "game": State.Game = Object(message, "game"); break;
            case "gameTile":
                if (State.Game["tiles"] is not JsonObject tiles) { tiles = new(); State.Game["tiles"] = tiles; }
                tiles[Number(message, "tile").ToString()] = message["at"]?.DeepClone(); break;
            case "friendRequest": case "invite": case "askJoin": case "online": case "poke": case "hit": case "attention": case "liveRequest":
                if (type is not ("poke" or "hit") || Text(message, "to") == State.SelfId)
                {
                    var notice = (JsonObject)message.DeepClone(); notice["targetId"] = message["id"]?.DeepClone(); notice["noticeId"] = Guid.NewGuid().ToString(); notice["unread"] = true;
                    notice["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); State.Notifications.Add(notice);
                    while (State.Notifications.Count > 100) State.Notifications.RemoveAt(0);
                }
                break;
        }
        MessageReceived?.Invoke((JsonObject)message.DeepClone());
        State.Touch();
    }

    private void ApplyItemDelta(string id, JsonObject action, string by)
    {
        if (State.Items[id] is not JsonObject item || Text(item, "kind") != "canvas") return;
        if (item["strokes"] is not JsonArray strokes) { strokes = new(); item["strokes"] = strokes; }
        switch (Text(action, "a"))
        {
            case "canvasClear": item["strokes"] = new JsonArray(); break;
            case "strokeStart":
                strokes.Add(new JsonObject { ["id"] = Text(action, "id"), ["by"] = by, ["color"] = Text(action, "color"),
                    ["size"] = Math.Clamp(Number(action, "size"), 1, 40), ["pts"] = new JsonArray(Math.Clamp(Number(action, "x"), 0, 620), Math.Clamp(Number(action, "y"), 0, 450)) });
                if (strokes.Count > 3000) strokes.RemoveAt(0); break;
            case "strokeAdd":
                var stroke = strokes.OfType<JsonObject>().LastOrDefault(s => Text(s, "id") == Text(action, "id") && Text(s, "by") == by);
                if (stroke?["pts"] is not JsonArray pts || pts.Count > 8000) break;
                var incoming = Array(action, "pts");
                for (var i = 0; i + 1 < incoming.Count; i += 2)
                { pts.Add(Math.Clamp(incoming[i]?.GetValue<double>() ?? 0, 0, 620)); pts.Add(Math.Clamp(incoming[i + 1]?.GetValue<double>() ?? 0, 0, 450)); }
                break;
        }
        item["updatedBy"] = by;
    }

    private static void Upsert(JsonArray list, JsonObject item, int limit)
    {
        var id = Text(item, "id");
        var index = list.Select((node, i) => (node, i)).FirstOrDefault(x => x.node is JsonObject o && Text(o, "id") == id).i;
        if (list.Any(node => node is JsonObject o && Text(o, "id") == id)) list[index] = item;
        else list.Add(item);
        while (list.Count > limit) list.RemoveAt(0);
    }

    private void Persist()
    {
        if (!persistSettings) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
            var temporary = settingsPath + ".tmp";
            File.WriteAllText(temporary, new JsonObject { ["selfId"] = State.SelfId, ["name"] = State.Name, ["server"] = State.ServerUrl }.ToJsonString());
            File.Move(temporary, settingsPath, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
    private Task UiAsync(Action action, bool notify = true)
    {
        void Apply() { action(); if (notify) State.Touch(); }
        if (Dispatcher.UIThread.CheckAccess()) { Apply(); return Task.CompletedTask; }
        return Dispatcher.UIThread.InvokeAsync(Apply).GetTask();
    }
    private static JsonObject AsObject(object value) => value is JsonObject obj ? obj : JsonSerializer.SerializeToNode(value)!.AsObject();
    private static string Text(JsonObject obj, string key, string fallback = "") => obj[key]?.ToString() ?? fallback;
    private static long Number(JsonObject obj, string key) => obj[key] is JsonValue value && value.TryGetValue<long>(out var n) ? n : (long)(obj[key]?.GetValue<double>() ?? 0);
    private static bool Boolean(JsonObject obj, string key) => obj[key] is JsonValue value && value.TryGetValue<bool>(out var b) && b;
    private static JsonArray Array(JsonObject obj, string key) => obj[key]?.DeepClone() as JsonArray ?? new();
    private static JsonObject Object(JsonObject obj, string key) => obj[key]?.DeepClone() as JsonObject ?? new();
    private static string Friendly(Exception ex) => ex is WebSocketException ? "サーバーとの接続を確認してください。" : ex is KokoSync.ProtocolException ? "ルーム同期の接続を確認してください。" : ex.Message;
    public async ValueTask DisposeAsync() { await DisconnectAsync(); homeSend.Dispose(); roomSend.Dispose(); }
}
