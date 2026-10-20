using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using LiveKit.Rtc;

namespace Tonarium.Desktop.Media;

internal sealed class VideoFeed : IDisposable
{
    private readonly object sync = new();
    private VideoFrame? latest;
    private bool queued;
    private WriteableBitmap? bitmap;
    public event Action<WriteableBitmap?>? Changed;
    public WriteableBitmap? Bitmap => bitmap;

    public void Push(VideoFrame frame)
    {
        lock (sync)
        {
            latest = frame;
            if (queued) return;
            queued = true;
        }
        Dispatcher.UIThread.Post(Render, DispatcherPriority.Background);
    }

    private void Render()
    {
        VideoFrame? frame;
        lock (sync) { frame = latest; latest = null; queued = false; }
        if (frame is null || Changed is null) return;
        if (bitmap is null || bitmap.PixelSize.Width != frame.Width || bitmap.PixelSize.Height != frame.Height)
        {
            bitmap?.Dispose();
            bitmap = new WriteableBitmap(new PixelSize(frame.Width, frame.Height), new Vector(96, 96), PixelFormat.Bgra8888, AlphaFormat.Opaque);
        }
        using (var buffer = bitmap.Lock())
        {
            for (var y = 0; y < frame.Height; y++)
                Marshal.Copy(frame.DataBytes, y * frame.Width * 4, buffer.Address + y * buffer.RowBytes, frame.Width * 4);
        }
        Changed?.Invoke(bitmap);
    }

    public void Clear() => Dispatcher.UIThread.Post(() =>
    {
        lock (sync) latest = null;
        Changed?.Invoke(null);
        bitmap?.Dispose(); bitmap = null;
    });

    public void Dispose() => Clear();
}

internal sealed class VideoSurface : Grid
{
    private readonly VideoFeed feed;
    private readonly Image image = new() { Stretch = Stretch.Uniform };
    private readonly TextBlock waiting = new()
    {
        Text = "映像を待っています", Foreground = Brushes.Gray, FontSize = 14,
        HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
    };

    public VideoSurface(VideoFeed feed)
    {
        this.feed = feed;
        Background = new SolidColorBrush(Color.Parse("#11151A"));
        MinHeight = 120;
        Children.Add(image); Children.Add(waiting);
        AttachedToVisualTree += (_, _) => { feed.Changed += Update; Update(feed.Bitmap); };
        DetachedFromVisualTree += (_, _) => { feed.Changed -= Update; image.Source = null; };
    }

    private void Update(WriteableBitmap? bitmap)
    {
        image.Source = bitmap;
        waiting.IsVisible = bitmap is null;
        image.InvalidateVisual();
    }
}
