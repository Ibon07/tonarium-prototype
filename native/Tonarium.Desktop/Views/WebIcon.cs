using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Tonarium.Desktop.Views;

/// <summary>Original Web Icon.tsx geometry, rendered as native vectors.</summary>
public sealed class WebIcon : Control
{
    public static readonly StyledProperty<IBrush?> ForegroundProperty = AvaloniaProperty.Register<WebIcon, IBrush?>(nameof(Foreground), Brushes.Black);
    public IBrush? Foreground { get => GetValue(ForegroundProperty); set => SetValue(ForegroundProperty, value); }
    readonly string name;
    record Shape(Geometry Geometry, bool Fill = false);
    static readonly Dictionary<string, Shape[]> Icons = new()
    {
        ["settings"] = [new Shape(new EllipseGeometry(new Rect(9, 9, 6, 6))), new Shape(StreamGeometry.Parse("M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"))],
        ["left"] = [new Shape(StreamGeometry.Parse("M15 6l-6 6 6 6"))],
        ["right"] = [new Shape(StreamGeometry.Parse("M9 6l6 6-6 6"))],
        ["up"] = [new Shape(StreamGeometry.Parse("M6 15l6-6 6 6"))],
        ["down"] = [new Shape(StreamGeometry.Parse("M6 9l6 6 6-6"))],
        ["plus"] = [new Shape(StreamGeometry.Parse("M12 5v14M5 12h14"))],
        ["close"] = [new Shape(StreamGeometry.Parse("M6 6l12 12M18 6L6 18"))],
        ["maximize"] = [new Shape(StreamGeometry.Parse("M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"))],
        ["screen"] = [new Shape(new RectangleGeometry(new Rect(3, 4, 18, 12), 2, 2)), new Shape(StreamGeometry.Parse("M8 20h8M12 16v4"))],
        ["eye"] = [new Shape(StreamGeometry.Parse("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z")), new Shape(new EllipseGeometry(new Rect(9, 9, 6, 6)))],
        ["window"] = [new Shape(new RectangleGeometry(new Rect(3, 4, 18, 16), 2, 2)), new Shape(StreamGeometry.Parse("M3 9h18"))],
        ["layers"] = [new Shape(new RectangleGeometry(new Rect(8, 3, 13, 11), 2, 2)), new Shape(StreamGeometry.Parse("M16 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"))],
        ["mic"] = [new Shape(new RectangleGeometry(new Rect(9, 3, 6, 11), 3, 3)), new Shape(StreamGeometry.Parse("M5 11a7 7 0 0 0 14 0M12 18v3"))],
        ["volume"] = [new Shape(StreamGeometry.Parse("M4 9h4l5-4v14l-5-4H4z")), new Shape(StreamGeometry.Parse("M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"))],
        ["volumeOff"] = [new Shape(StreamGeometry.Parse("M4 9h4l5-4v14l-5-4H4z")), new Shape(StreamGeometry.Parse("M17 9l5 6M22 9l-5 6"))],
        ["micOff"] = [new Shape(new RectangleGeometry(new Rect(9, 3, 6, 11), 3, 3)), new Shape(StreamGeometry.Parse("M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"))],
        ["music"] = [new Shape(StreamGeometry.Parse("M9 18V6l10-2v12")), new Shape(new EllipseGeometry(new Rect(5, 16, 4, 4))), new Shape(new EllipseGeometry(new Rect(15, 14, 4, 4)))],
        ["cube"] = [new Shape(StreamGeometry.Parse("M12 3l8 4.5v9L12 21l-8-4.5v-9z")), new Shape(StreamGeometry.Parse("M4 7.5l8 4.5 8-4.5M12 12v9"))],
        ["flat"] = [new Shape(new RectangleGeometry(new Rect(3, 5, 18, 14), 2, 2)), new Shape(StreamGeometry.Parse("M3 10h18"))],
        ["leave"] = [new Shape(StreamGeometry.Parse("M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"))],
        ["send"] = [new Shape(StreamGeometry.Parse("M4 12l16-8-6 16-2-7z"))],
        ["attach"] = [new Shape(StreamGeometry.Parse("M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"))],
        ["megaphone"] = [new Shape(StreamGeometry.Parse("M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z")), new Shape(StreamGeometry.Parse("M17 9a4 4 0 0 1 0 6"))],
        ["bell"] = [new Shape(StreamGeometry.Parse("M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z")), new Shape(StreamGeometry.Parse("M10 20a2 2 0 0 0 4 0"))],
        ["chat"] = [new Shape(StreamGeometry.Parse("M4 5h16v11H9l-5 4z"))],
        ["people"] = [new Shape(new EllipseGeometry(new Rect(5.8, 4.8, 6.4, 6.4))), new Shape(StreamGeometry.Parse("M3 20a6 6 0 0 1 12 0")), new Shape(new EllipseGeometry(new Rect(14.6, 6.6, 4.8, 4.8))), new Shape(StreamGeometry.Parse("M16 14.2a5 5 0 0 1 5.5 5.8"))],
        ["box"] = [new Shape(StreamGeometry.Parse("M3 7l9-4 9 4-9 4z")), new Shape(StreamGeometry.Parse("M3 7v10l9 4 9-4V7"))],
        ["near"] = [new Shape(StreamGeometry.Parse("M3 11l18-8-8 18-2-8z"))],
        ["follow"] = [new Shape(new EllipseGeometry(new Rect(6, 5, 6, 6))), new Shape(StreamGeometry.Parse("M3 20a6 6 0 0 1 12 0")), new Shape(StreamGeometry.Parse("M16 10h5m-2-2 2 2-2 2"))],
        ["poke"] = [new Shape(StreamGeometry.Parse("M10 12V6a1.5 1.5 0 0 1 3 0v5m0-1a1.5 1.5 0 0 1 3 0v1.5m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4-2l-2.6-3.6a1.5 1.5 0 0 1 2.4-1.8L10 15")), new Shape(StreamGeometry.Parse("M4 3l2 2M3 8h2.5M8 2v2"))],
        ["hand"] = [new Shape(StreamGeometry.Parse("M7 11V7a1.5 1.5 0 0 1 3 0v3m0-4.5a1.5 1.5 0 0 1 3 0V10m0-3.5a1.5 1.5 0 0 1 3 0V11m0-2a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 14a1.5 1.5 0 0 1 2.5-1.6L7 14"))],
        ["trash"] = [new Shape(StreamGeometry.Parse("M4 7h16M10 11v6M14 11v6")), new Shape(StreamGeometry.Parse("M6 7l1 13h10l1-13M9 7V4h6v3"))],
        ["speaking"] = [new Shape(StreamGeometry.Parse("M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"))],
        ["pin"] = [new Shape(StreamGeometry.Parse("M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z")), new Shape(new EllipseGeometry(new Rect(9.8, 7.8, 4.4, 4.4)))],
        ["user"] = [new Shape(new EllipseGeometry(new Rect(8.5, 4.5, 7, 7))), new Shape(StreamGeometry.Parse("M5 20a7 7 0 0 1 14 0"))],
        ["play"] = [new Shape(StreamGeometry.Parse("M7 4.5v15l12-7.5z"))],
        ["pause"] = [new Shape(StreamGeometry.Parse("M8 5v14M16 5v14"))],
        ["sparkle"] = [new Shape(StreamGeometry.Parse("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z")), new Shape(StreamGeometry.Parse("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"))],
        ["image"] = [new Shape(new RectangleGeometry(new Rect(3, 4, 18, 16), 2, 2)), new Shape(new EllipseGeometry(new Rect(7, 8, 4, 4))), new Shape(StreamGeometry.Parse("M21 16l-5-5-9 9"))],
        ["home"] = [new Shape(StreamGeometry.Parse("M3 11l9-7 9 7")), new Shape(StreamGeometry.Parse("M5 10v10h14V10")), new Shape(StreamGeometry.Parse("M10 20v-6h4v6"))],
        ["headset"] = [new Shape(StreamGeometry.Parse("M4 14v-2a8 8 0 0 1 16 0v2")), new Shape(new RectangleGeometry(new Rect(3, 13, 4, 6), 1.5, 1.5)), new Shape(new RectangleGeometry(new Rect(17, 13, 4, 6), 1.5, 1.5))],
        ["calendar"] = [new Shape(new RectangleGeometry(new Rect(3, 5, 18, 16), 2, 2)), new Shape(StreamGeometry.Parse("M3 10h18M8 3v4M16 3v4"))],
        ["flag"] = [new Shape(StreamGeometry.Parse("M5 21V4")), new Shape(StreamGeometry.Parse("M5 4h12l-2 4 2 4H5"))],
        ["globe"] = [new Shape(new EllipseGeometry(new Rect(3, 3, 18, 18))), new Shape(StreamGeometry.Parse("M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"))],
        ["search"] = [new Shape(new EllipseGeometry(new Rect(4.5, 4.5, 13, 13))), new Shape(StreamGeometry.Parse("M16 16l5 5"))],
        ["menu"] = [new Shape(StreamGeometry.Parse("M4 7h16M4 12h16M4 17h16"))],
        ["vr"] = [new Shape(StreamGeometry.Parse("M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4l-3-3-3 3H5a2 2 0 0 1-2-2z")), new Shape(new EllipseGeometry(new Rect(6.7, 10.7, 2.6, 2.6))), new Shape(new EllipseGeometry(new Rect(14.7, 10.7, 2.6, 2.6)))],
        ["check"] = [new Shape(StreamGeometry.Parse("M5 12.5l4.5 4.5L19 7.5"))],
        ["lock"] = [new Shape(new RectangleGeometry(new Rect(5, 11, 14, 9), 2, 2)), new Shape(StreamGeometry.Parse("M8 11V8a4 4 0 0 1 8 0v3"))],
        ["link"] = [new Shape(StreamGeometry.Parse("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1")), new Shape(StreamGeometry.Parse("M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"))],
        ["heart"] = [new Shape(StreamGeometry.Parse("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"))],
        ["more"] = [new Shape(new EllipseGeometry(new Rect(3.2,10.2,3.6,3.6)),true), new Shape(new EllipseGeometry(new Rect(10.2,10.2,3.6,3.6)),true), new Shape(new EllipseGeometry(new Rect(17.2,10.2,3.6,3.6)),true)],
    };
    static WebIcon() { AffectsRender<WebIcon>(ForegroundProperty); }
    public WebIcon(string name, double size = 16, IBrush? brush = null)
    {
        this.name = name; Width = Height = size; Foreground = brush ?? Ui.Brush(Ui.Ink);
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center;
    }
    public override void Render(DrawingContext context)
    {
        if (!Icons.TryGetValue(name, out var shapes)) return;
        using var scale = context.PushTransform(Matrix.CreateScale(Bounds.Width / 24, Bounds.Height / 24));
        var pen = new Pen(Foreground, 2, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);
        foreach (var shape in shapes) context.DrawGeometry(shape.Fill ? Foreground : null, shape.Fill ? null : pen, shape.Geometry);
    }
}
