using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace Tonarium.Desktop.Views;

internal sealed class DieTile(int sides, string value) : Control
{
    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var (fill, ink) = sides switch { 4 => ("#e0604c", "#fff"), 6 => ("#f3efe6", "#3a2a1e"), 8 => ("#4b7fd9", "#fff"), 10 => ("#3f9f66", "#fff"), 12 => ("#8f5cc9", "#fff"), 20 => ("#e2ad35", "#3a2a1e"), _ => ("#33404f", "#fff") };
        Point[] vertices = sides switch
        {
            4 => [new(23,0),new(46,46),new(0,46)],
            8 => [new(23,0),new(46,23),new(23,46),new(0,23)],
            10 or 100 => [new(23,0),new(46,20.7),new(23,46),new(0,20.7)],
            12 => [new(23,0),new(46,17.5),new(37.7,46),new(8.3,46),new(0,17.5)],
            20 => [new(11.5,0),new(34.5,0),new(46,23),new(34.5,46),new(11.5,46),new(0,23)],
            _ => []
        };
        if(vertices.Length==0) context.DrawRectangle(ItemWindow.Brush(fill),null,new Rect(0,0,46,46),9,9);
        else {var shape=new StreamGeometry();using(var path=shape.Open()){path.BeginFigure(vertices[0],true);foreach(var p in vertices.Skip(1))path.LineTo(p);path.EndFigure(true);}context.DrawGeometry(ItemWindow.Brush(fill),null,shape);}
        var text=new FormattedText(value,System.Globalization.CultureInfo.CurrentCulture,FlowDirection.LeftToRight,new Typeface(Ui.HeadingFont,FontStyle.Normal,FontWeight.ExtraBold),sides==100?14:18,ItemWindow.Brush(ink));
        context.DrawText(text,new Point((46-text.Width)/2,(46-text.Height)/2+(sides==4?7:sides==12?2:0)));
    }
    protected override Size MeasureOverride(Size availableSize) => new(46,46);
}
