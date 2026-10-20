using Avalonia;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using System.Runtime.InteropServices;

namespace Tonarium.Desktop.Views;

internal static class WebGround
{
    private static readonly IBrush Pattern = CreatePattern();
    private static IBrush CreatePattern()
    {
        // 顔の更新ごとに数千個の点を再描画しないよう、22pxの模様を共有する。
        const int side = 44;
        var pixels = new int[side * side];
        for (int y = 0; y < side; y++)
        for (int x = 0; x < side; x++)
        {
            double distance = Math.Sqrt(Math.Pow(x + .5 - 22, 2) + Math.Pow(y + .5 - 22, 2));
            double coverage = Math.Clamp(2.5 - distance, 0, 1);
            int r = (int)Math.Round(234 + (214 - 234) * coverage);
            int g = (int)Math.Round(229 + (207 - 229) * coverage);
            int b = (int)Math.Round(219 + (193 - 219) * coverage);
            pixels[y * side + x] = unchecked((int)0xff000000) | r << 16 | g << 8 | b;
        }
        var bitmap = new WriteableBitmap(new PixelSize(side, side), new Vector(192, 192), PixelFormat.Bgra8888, AlphaFormat.Opaque);
        using (var buffer = bitmap.Lock())
            for (int y = 0; y < side; y++) Marshal.Copy(pixels, y * side, IntPtr.Add(buffer.Address, y * buffer.RowBytes), side);
        return new ImageBrush(bitmap)
        {
            TileMode = TileMode.Tile,
            Stretch = Stretch.Fill,
            SourceRect = new RelativeRect(0, 0, 1, 1, RelativeUnit.Relative),
            DestinationRect = new RelativeRect(0, 0, 22, 22, RelativeUnit.Absolute)
        };
    }
    public static void Draw(DrawingContext context, Size size) => context.FillRectangle(Pattern, new Rect(size));
}
