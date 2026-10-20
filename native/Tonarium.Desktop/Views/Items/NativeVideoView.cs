using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Threading;
using LibVLCSharp.Shared;
using LibVLCSharp.Avalonia;

namespace Tonarium.Desktop.Views;

internal sealed class NativeVideoView : StackPanel, IDisposable
{
    private LibVLC? vlc;
    private MediaPlayer? player;
    private LibVLCSharp.Shared.Media? media;
    private readonly TextBlock time = ItemWindow.Text("読み込み中…", 13);
    private readonly Slider seek = new() { Minimum = 0, Maximum = 100, MinWidth = 240 };
    private readonly Action<object> send;
    private bool dragging;
    private bool surfaceLoaded;
    private bool serverPlaying;
    private JsonObject? pendingClock;
    private long pendingOffset;
    private readonly Button toggle;
    public NativeVideoView(string url, Action<object> send)
    {
        this.send = send; Spacing = 10;
        toggle = ItemWindow.Button("▶ 再生", () => send(new { a = serverPlaying ? "mediaPause" : "mediaPlay", pos = CurrentPosition }));
        try
        {
            LibVLCSharp.Shared.Core.Initialize();
            vlc = new LibVLC("--no-video-title-show", "--quiet"); player = new MediaPlayer(vlc) { Volume = 50 }; media = new LibVLCSharp.Shared.Media(vlc, new Uri(url)); player.Media = media;
            var surface = new VideoView { MediaPlayer = player, Height = 340, HorizontalAlignment = HorizontalAlignment.Stretch };
            Children.Add(surface);
            // Start only after the native video HWND exists, otherwise VLC can open its own window.
            player.Playing += (_, _) => Dispatcher.UIThread.Post(() => { if (!serverPlaying) player?.SetPause(true); });
            player.EndReached += (_, _) => Dispatcher.UIThread.Post(() =>
            {
                if (player is not null && serverPlaying) send(new { a = "mediaPause", pos = Math.Max(0, player.Length / 1000d) });
            });
            surface.Loaded += (_, _) => { surfaceLoaded = true; player?.Play(); UpdateClock(pendingClock, pendingOffset); };
        }
        catch (Exception error) { Children.Add(ItemWindow.Text("動画プレーヤーを起動できません: " + error.Message)); }
        seek.PointerPressed += (_, _) => dragging = true;
        seek.PointerReleased += (_, _) => { dragging = false; send(new { a = "mediaSeek", pos = seek.Value }); };
        var volume = new Slider { Minimum = 0, Maximum = 100, Value = 50, Width = 100 };
        volume.PropertyChanged += (_, e) => { if (e.Property == Slider.ValueProperty && player is not null) player.Volume = (int)volume.Value; };
        Children.Add(seek); Children.Add(ItemWindow.Row(toggle, time, ItemWindow.Text("音量", 12), volume));
    }
    private double CurrentPosition => Math.Max(0, player?.Time / 1000d ?? 0);
    public void UpdateClock(JsonObject? clock, long offset = 0)
    {
        pendingClock = clock; pendingOffset = offset;
        if (clock is null || player is null || !surfaceLoaded) return;
        var position = ItemWindow.ClockPosition(clock, offset); var playing = ItemWindow.Bool(clock, "playing");
        if (Math.Abs(CurrentPosition - position) > 1.8) player.Time = (long)(position * 1000);
        if (playing != serverPlaying || playing && !player.IsPlaying || !playing && player.IsPlaying) { if (playing) player.Play(); else player.SetPause(true); }
        serverPlaying = playing;
        toggle.Content = playing ? "Ⅱ 一時停止" : "▶ 再生";
        if (player.Length > 0) seek.Maximum = player.Length / 1000d;
        if (!dragging) seek.Value = Math.Clamp(position, 0, seek.Maximum);
        time.Text = TimeSpan.FromSeconds(position).ToString(@"hh\:mm\:ss");
    }
    public void Dispose() { player?.Stop(); player?.Dispose(); media?.Dispose(); vlc?.Dispose(); player = null; }
}
