using Avalonia.Controls;

namespace Tonarium.Desktop.Media;

public interface INativeMedia : IAsyncDisposable
{
    event Action? Changed;
    event Action<string, byte[]>? VideoFrameJpeg;
    string Status { get; }
    Task ConnectAsync(string sessionId);
    Task DisconnectAsync();
    Task SetMicrophoneAsync(bool enabled);
    Task SetScreenShareAsync(bool enabled);
    Control CreateVideoView(string participantId);
}
