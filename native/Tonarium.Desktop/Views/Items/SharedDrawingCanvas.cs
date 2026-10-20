using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;

namespace Tonarium.Desktop.Views;

internal sealed class SharedDrawingCanvas : Control
{
    private sealed class Preview(string id, string color, double size)
    {
        public string Id = id;
        public string Color = color;
        public double Size = size;
        public List<Point> Points = [];
    }
    private readonly Func<JsonObject?> item;
    private readonly Action<object> send;
    private readonly List<Preview> pending = [];
    private Preview? active;
    private Point last;
    public string PenColor { get; set; } = "#111111";
    public double PenSize { get; set; } = 3;

    public SharedDrawingCanvas(Func<JsonObject?> item, Action<object> send)
    {
        this.item = item; this.send = send;
        Width = 620; Height = 450; ClipToBounds = true; Cursor = new Cursor(StandardCursorType.Cross);
        PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
            var p = ClampPoint(e.GetPosition(this)); last = p;
            active = new Preview(Guid.NewGuid().ToString("N"), PenColor, PenSize); active.Points.Add(p); pending.Add(active);
            send(new { a = "strokeStart", id = active.Id, color = active.Color, size = active.Size, x = p.X, y = p.Y });
            e.Pointer.Capture(this); e.Handled = true; InvalidateVisual();
        };
        PointerMoved += (_, e) =>
        {
            if (active is null) return; var p = ClampPoint(e.GetPosition(this));
            if (Math.Abs(p.X - last.X) + Math.Abs(p.Y - last.Y) < 2) return;
            last = p; active.Points.Add(p); send(new { a = "strokeAdd", id = active.Id, pts = new[] { p.X, p.Y } }); InvalidateVisual();
        };
        PointerReleased += (_, e) => { active = null; e.Pointer.Capture(null); InvalidateVisual(); };
        PointerCaptureLost += (_, _) => active = null;
    }

    public void ClearPreview() { pending.Clear(); active = null; InvalidateVisual(); }
    private static Point ClampPoint(Point p) => new(Math.Round(Math.Clamp(p.X, 0, 620)), Math.Round(Math.Clamp(p.Y, 0, 450)));

    public override void Render(DrawingContext context)
    {
        base.Render(context); context.FillRectangle(Brushes.White, new Rect(0, 0, 620, 450));
        var strokes = ItemWindow.Arr(item(), "strokes");
        foreach (var stroke in strokes.OfType<JsonObject>())
        {
            var id = ItemWindow.Str(stroke, "id"); var preview = pending.FirstOrDefault(p => p.Id == id);
            var raw = ItemWindow.Arr(stroke, "pts");
            if (preview is not null && preview.Points.Count * 2 > raw.Count) Draw(context, preview.Color, preview.Size, preview.Points);
            else
            {
                var points = new List<Point>(); for (int i = 0; i + 1 < raw.Count; i += 2) points.Add(new Point(ItemWindow.Num(raw[i]), ItemWindow.Num(raw[i + 1])));
                Draw(context, ItemWindow.Str(stroke, "color"), ItemWindow.Num(stroke, "size", 3), points);
                if (preview is not null && preview != active) pending.Remove(preview);
            }
        }
        foreach (var stroke in pending) if (!strokes.Any(s => ItemWindow.Str(s, "id") == stroke.Id)) Draw(context, stroke.Color, stroke.Size, stroke.Points);
    }

    private static void Draw(DrawingContext context, string color, double size, List<Point> points)
    {
        if (points.Count == 0) return;
        IBrush brush;
        try { brush = color == "erase" ? Brushes.White : ItemWindow.Brush(color); } catch { brush = Brushes.Black; }
        var pen = new Pen(brush, size, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);
        context.DrawEllipse(brush, null, points[0], size / 2, size / 2);
        for (int i = 1; i < points.Count; i++) context.DrawLine(pen, points[i - 1], points[i]);
    }
}
