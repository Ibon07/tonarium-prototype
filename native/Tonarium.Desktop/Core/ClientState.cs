using System.Text.Json.Nodes;
using Avalonia.Threading;

namespace Tonarium.Desktop.Core;

/// <summary>Authoritative social and room state shared by the native UI, media and Unity.</summary>
public sealed class ClientState
{
    public string SelfId { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string ServerUrl { get; set; } = "http://localhost:3001";
    public string ConnectionStatus { get; set; } = "未接続";
    public string SyncStatus { get; set; } = "off";
    public string Mode { get; set; } = "2d";
    public string World { get; set; } = "room";
    public string? SessionId { get; set; }
    public bool Connected { get; set; }
    public double FxVolume { get; set; } = 1;
    public bool MicOn { get; set; }
    public bool Sharing { get; set; }
    public bool Broadcast { get; set; }
    public JsonObject Snapshot { get; set; } = new();
    public JsonObject Items { get; set; } = new();
    public JsonObject Avatars { get; set; } = new();
    public JsonObject Emotes { get; set; } = new();
    public JsonObject Presence { get; set; } = new();
    public JsonObject Conversations { get; set; } = new();
    public JsonObject Reads { get; set; } = new();
    public JsonObject SessionInfo { get; set; } = new();
    public JsonObject Survivor { get; set; } = new();
    public JsonObject SurvivorProfile { get; set; } = new();
    public JsonObject Game { get; set; } = new();
    public JsonArray Users { get; set; } = new();
    public JsonArray Sessions { get; set; } = new();
    public JsonArray Groups { get; set; } = new();
    public JsonArray Events { get; set; } = new();
    public JsonArray Friends { get; set; } = new();
    public JsonArray People { get; set; } = new();
    public JsonArray Chats { get; set; } = new();
    public JsonArray Notifications { get; set; } = new();
    public JsonArray Watching { get; set; } = new();
    public JsonArray RecentStatus { get; set; } = new();
    public JsonObject? WorldPending { get; set; }
    public long? LastSeen { get; set; }
    public long ServerOffset { get; set; }
    public string? LastError { get; set; }
    public event Action? Changed;

    public void Touch()
    {
        if (Dispatcher.UIThread.CheckAccess()) Changed?.Invoke();
        else Dispatcher.UIThread.Post(() => Changed?.Invoke());
    }
}
