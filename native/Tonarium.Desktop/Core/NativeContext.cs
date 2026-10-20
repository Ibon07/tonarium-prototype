using Avalonia.Controls;
using Tonarium.Desktop.Media;

namespace Tonarium.Desktop.Core;

public sealed class NativeContext(TonariumClient client, INativeMedia media, Window owner)
{
    public TonariumClient Client { get; } = client;
    public ClientState State => Client.State;
    public INativeMedia Media { get; } = media;
    public Window Owner { get; set; } = owner;
    public Action<string>? NotificationRequested { get; set; }
    public Action<string>? ItemRequested { get; set; }
    public Action<string>? ProfileRequested { get; set; }
    public Action<string>? HomeRequested { get; set; }
    public string HomeRoute { get; set; } = "home";
    public bool HomeIsOpen { get; set; }
    public Func<string, Task>? ModeRequested { get; set; }
    public Func<double, double, double, Task>? TeleportRequested { get; set; }
    public void Notify(string text) => NotificationRequested?.Invoke(text);
    public void OpenItem(string id) => ItemRequested?.Invoke(id);
    public void OpenProfile(string id) => ProfileRequested?.Invoke(id);
    public void ShowHome(string page) => HomeRequested?.Invoke(page);
    public Task ChangeModeAsync(string mode) => ModeRequested?.Invoke(mode) ?? Task.CompletedTask;
    public Task TeleportAsync(double x, double z, double ry) => TeleportRequested?.Invoke(x, z, ry) ?? Client.SendRoomAsync(new { t = "avatar", s = new { x, z, ry } });
}
