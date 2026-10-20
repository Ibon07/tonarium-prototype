using System.Net.Http;
using System.Security.Cryptography;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed class ChatMediaPreview : Border
{
    private readonly NativeContext context;
    private readonly Image image = new() { Stretch = Stretch.Uniform, MaxHeight = 180, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly TextBlock placeholder = Ui.Text("画像を読み込み中…", 12, Ui.Muted);
    private Bitmap? thumbnail;
    private Task? loading;
    private int generation;
    public string SourceUrl { get; }
    public bool IsImageLoaded => image.Source is not null;

    public ChatMediaPreview(NativeContext context, string url)
    {
        this.context = context; SourceUrl = url;
        MaxHeight = 180; MaxWidth = 480; HorizontalAlignment = HorizontalAlignment.Left;
        CornerRadius = new CornerRadius(8); ClipToBounds = true; Margin = new Thickness(0, 4, 0, 0);
        Cursor = new Cursor(StandardCursorType.Hand); Focusable = true;
        var contents = new Grid(); contents.Children.Add(image); contents.Children.Add(placeholder); Child = contents;
        AutomationProperties.SetName(this, "画像を拡大して表示"); ToolTip.SetTip(this, "クリックで画像を拡大");
        PointerReleased += (_, e) => { if (e.InitialPressMouseButton == MouseButton.Left) { ShowViewer(context, SourceUrl); e.Handled = true; } };
        KeyDown += (_, e) => { if (e.Key is Key.Enter or Key.Space) { ShowViewer(context, SourceUrl); e.Handled = true; } };
        AttachedToVisualTree += (_, _) => _ = LoadAsync();
        DetachedFromVisualTree += (_, _) => { generation++; loading = null; image.Source = null; thumbnail?.Dispose(); thumbnail = null; placeholder.IsVisible = true; };
        _ = LoadAsync();
    }

    public Task LoadAsync() => loading ??= LoadCoreAsync(generation);

    private async Task LoadCoreAsync(int expectedGeneration)
    {
        Bitmap? decoded = null;
        try
        {
            var data = await ImageCache.GetAsync(context.State.ServerUrl, SourceUrl);
            decoded = await Task.Run(() =>
            {
                using var stream = new MemoryStream(data.Bytes);
                var scale = Math.Min(1, Math.Min(720d / data.Width, 270d / data.Height));
                return Bitmap.DecodeToWidth(stream, Math.Max(1, (int)Math.Ceiling(data.Width * scale)), BitmapInterpolationMode.HighQuality);
            });
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (expectedGeneration != generation) return;
                thumbnail?.Dispose(); thumbnail = decoded; image.Source = decoded;
                decoded = null;
                image.MaxWidth = Math.Min(480, data.Width); placeholder.IsVisible = false;
            });
        }
        catch (Exception error)
        {
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (expectedGeneration != generation) return;
                placeholder.Text = "画像を表示できません"; placeholder.IsVisible = true;
                ToolTip.SetTip(this, error.Message);
            });
        }
        finally { decoded?.Dispose(); }
    }

    public static Window ShowViewer(NativeContext context, string url)
    {
        var owner = context.Owner;
        var window = new Window
        {
            Title = "画像 · Tonarium", Width = Math.Max(640, owner.Bounds.Width), Height = Math.Max(420, owner.Bounds.Height),
            MinWidth = 320, MinHeight = 240, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            WindowDecorations = WindowDecorations.None, ShowInTaskbar = false, Background = new SolidColorBrush(Color.Parse("#F2141418"))
        };
        var root = new Grid { Background = Brushes.Transparent };
        var fullImage = new Image { Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var frame = new Border { Child = fullImage, CornerRadius = new CornerRadius(10), ClipToBounds = true, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, BoxShadow = new BoxShadows(new BoxShadow { Blur = 32, OffsetY = 8, Color = Colors.Black }) };
        root.Children.Add(frame);
        var status = Ui.Text("画像を読み込み中…", 14, "#FFFFFF"); status.HorizontalAlignment = HorizontalAlignment.Center; status.VerticalAlignment = VerticalAlignment.Center; root.Children.Add(status);
        var save = Ui.Button("保存", () => { }); save.IsEnabled = false; save.Background = new SolidColorBrush(Color.Parse("#2F5FC4")); save.Foreground = Brushes.White; save.BorderThickness = new Thickness(0);
        var close = Ui.Button("", window.Close); close.Content = new WebIcon("close", 20, Brushes.White); close.Background = new SolidColorBrush(Color.Parse("#6626262E")); close.BorderThickness = new Thickness(0); close.Width = close.Height = 38; close.Padding = new Thickness(0); AutomationProperties.SetName(close, "画像を閉じる");
        var toolbar = Ui.Row(save, close); toolbar.HorizontalAlignment = HorizontalAlignment.Right; toolbar.VerticalAlignment = VerticalAlignment.Top; toolbar.Margin = new Thickness(16); root.Children.Add(toolbar);
        window.Content = root;
        ImageData? loaded = null;
        void Resize() { frame.MaxWidth = Math.Min(loaded?.Width ?? double.MaxValue, Math.Max(1, window.Bounds.Width * .92)); frame.MaxHeight = Math.Min(loaded?.Height ?? double.MaxValue, Math.Max(1, window.Bounds.Height * .88)); fullImage.MaxWidth = frame.MaxWidth; fullImage.MaxHeight = frame.MaxHeight; }
        window.SizeChanged += (_, _) => Resize();
        window.Opened += (_, _) => close.Focus();
        root.PointerPressed += (_, e) => { if (ReferenceEquals(e.Source, root)) { window.Close(); e.Handled = true; } };
        window.AddHandler(InputElement.KeyDownEvent, (_, e) => { if (e.Key == Key.Escape) { e.Handled = true; window.Close(); } }, RoutingStrategies.Tunnel);
        Bitmap? bitmap = null; bool closed = false;
        window.Closed += (_, _) => { closed = true; fullImage.Source = null; bitmap?.Dispose(); bitmap = null; };
        save.Click += async (_, _) =>
        {
            if (loaded is null) return;
            try
            {
                var destination = await window.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
                {
                    Title = "画像を保存", SuggestedFileName = loaded.FileName,
                    DefaultExtension = Path.GetExtension(loaded.FileName).TrimStart('.'),
                    FileTypeChoices = [FilePickerFileTypes.ImageAll, FilePickerFileTypes.All]
                });
                if (destination is null) return;
                await using var output = await destination.OpenWriteAsync(); output.SetLength(0); await output.WriteAsync(loaded.Bytes);
                context.Notify("画像を保存しました");
            }
            catch (Exception error) { context.Notify("画像を保存できませんでした: " + error.Message); }
        };
        window.Show(owner); Resize(); _ = LoadOriginalAsync(); return window;

        async Task LoadOriginalAsync()
        {
            try
            {
                var data = await ImageCache.GetAsync(context.State.ServerUrl, url);
                var decoded = await Task.Run(() => { using var stream = new MemoryStream(data.Bytes); return new Bitmap(stream); });
                await Dispatcher.UIThread.InvokeAsync(() =>
                {
                    if (closed) { decoded.Dispose(); return; }
                    loaded = data; bitmap = decoded; fullImage.Source = decoded; Resize(); status.IsVisible = false; save.IsEnabled = true;
                });
            }
            catch (Exception error) { await Dispatcher.UIThread.InvokeAsync(() => { if (!closed) status.Text = "画像を表示できませんでした\n" + error.Message; }); }
        }
    }

    private sealed record ImageData(byte[] Bytes, int Width, int Height, string FileName);

    private static class ImageCache
    {
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
        private static readonly object Gate = new();
        private static readonly Dictionary<string, Task<ImageData>> Entries = new();
        private static readonly Queue<string> Order = new();

        public static Task<ImageData> GetAsync(string server, string url)
        {
            var source = url.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? url : new Uri(new Uri(server.TrimEnd('/') + "/"), url).ToString();
            var key = source.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? "data:" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(source))) : source;
            lock (Gate)
            {
                if (Entries.TryGetValue(key, out var cached)) return cached;
                var task = ReadAsync(source); Entries[key] = task; Order.Enqueue(key);
                while (Entries.Count > 24 && Order.TryDequeue(out var old)) Entries.Remove(old);
                _ = TrimWhenReadyAsync(key, task); return task;
            }
        }

        private static async Task TrimWhenReadyAsync(string key, Task<ImageData> task)
        {
            try { await task; }
            catch { lock (Gate) Entries.Remove(key); return; }
            lock (Gate)
            {
                long bytes = Entries.Values.Where(t => t.IsCompletedSuccessfully).Sum(t => (long)t.Result.Bytes.Length);
                while (bytes > 64 * 1024 * 1024 && Order.TryDequeue(out var old))
                {
                    if (Entries.Remove(old, out var entry) && entry.IsCompletedSuccessfully) bytes -= entry.Result.Bytes.Length;
                }
            }
        }

        private static async Task<ImageData> ReadAsync(string source)
        {
            byte[] bytes; string fileName;
            if (source.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                var comma = source.IndexOf(','); if (comma < 0) throw new InvalidDataException("画像のデータ形式を読み取れません。");
                var header = source[5..comma]; var payload = source[(comma + 1)..];
                bytes = header.Contains(";base64", StringComparison.OrdinalIgnoreCase) ? Convert.FromBase64String(payload) : System.Text.Encoding.UTF8.GetBytes(Uri.UnescapeDataString(payload));
                var extension = header.Split(';')[0].ToLowerInvariant() switch { "image/jpeg" => ".jpg", "image/webp" => ".webp", "image/gif" => ".gif", "image/bmp" => ".bmp", _ => ".png" };
                fileName = "tonarium" + extension;
            }
            else
            {
                using var response = await Http.GetAsync(source, HttpCompletionOption.ResponseHeadersRead); response.EnsureSuccessStatusCode();
                bytes = await response.Content.ReadAsByteArrayAsync();
                fileName = Path.GetFileName(Uri.UnescapeDataString(new Uri(source).AbsolutePath));
                if (string.IsNullOrWhiteSpace(fileName) || Path.GetExtension(fileName).Length == 0) fileName = "tonarium.png";
            }
            return await Task.Run(() =>
            {
                using var stream = new MemoryStream(bytes); using var decoded = new Bitmap(stream);
                return new ImageData(bytes, decoded.PixelSize.Width, decoded.PixelSize.Height, fileName);
            });
        }
    }
}
