using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Tonarium.Desktop.Views;

public static class Ui
{
    public const string Ink = "#26262E", Muted = "#5E5C64", Purple = "#5B47A8", Orange = "#DB925D", Background = "#EAE5DB", Paper = "#FFFDF9";
    public static IBrush Brush(string value) => SolidColorBrush.Parse(value);
    public static TextBlock Text(string text, double size = 14, string? color = null) => new() { Text = text, FontSize = size, Foreground = Brush(color ?? Ink), TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
    public static Button Button(string text, Action action)
    {
        var button = new Button { Content = text, Padding = new Thickness(14, 9), CornerRadius = new CornerRadius(10), Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.Hand) };
        button.Click += (_, _) => action();
        return button;
    }
    public static Border Card(Control child) => new() { Child = child, Background = Brush(Paper), CornerRadius = new CornerRadius(18), Padding = new Thickness(20), BorderBrush = Brush("#e5e0d8"), BorderThickness = new Thickness(1) };
    public static StackPanel Row(params Control[] children) { var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 }; foreach (var child in children) panel.Children.Add(child); return panel; }
    public static StackPanel Column(params Control[] children) { var panel = new StackPanel { Spacing = 12 }; foreach (var child in children) panel.Children.Add(child); return panel; }
    public static TextBox Input(string watermark, string text = "") => new() { PlaceholderText = watermark, Text = text, MinHeight = 40, CornerRadius = new CornerRadius(9) };
    public static Control Title(string text, string? subtitle = null)
    {
        var title = Text(text, 26); title.FontWeight = FontWeight.SemiBold;
        return subtitle is null ? title : Column(title, Text(subtitle, 13, Muted));
    }
}
