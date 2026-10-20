using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;

namespace Tonarium.Desktop.Views;

public static class WebAssets
{
    static readonly Dictionary<string, Bitmap> Cache = new();
    public static WindowIcon WindowIcon()
    {
        using var stream = AssetLoader.Open(new Uri("avares://Tonarium/Assets/brand/favicon.png"));
        return new WindowIcon(stream);
    }
    public static Image Image(string path, double? width = null, double? height = null)
    {
        path = path.TrimStart('/');
        if (!path.StartsWith("Assets/")) path = "Assets/" + path;
        if (!Cache.TryGetValue(path, out var bitmap))
        {
            using var stream = AssetLoader.Open(new Uri("avares://Tonarium/" + path));
            Cache[path] = bitmap = new Bitmap(stream);
        }
        var image = new Image { Source = bitmap, Stretch = Stretch.Uniform };
        if (width is { } w) image.Width = w;
        if (height is { } h) image.Height = h;
        return image;
    }
}
