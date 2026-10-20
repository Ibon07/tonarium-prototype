using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using Tonarium.Desktop.Views;

namespace Tonarium.Desktop;

public sealed class App : Application
{
    public override void Initialize()
    {
        RequestedThemeVariant = ThemeVariant.Light;
        Styles.Add(new FluentTheme());
        Styles.Add(new Style(x => x.OfType<Window>())
        {
            Setters = { new Setter(Window.FontFamilyProperty, Ui.BodyFont), new Setter(Window.IconProperty, WebAssets.WindowIcon()), new Setter(Window.FontSizeProperty, 14d), new Setter(Window.BackgroundProperty, Ui.Brush(Ui.Background)), new Setter(Window.ForegroundProperty, Ui.Brush(Ui.Ink)) }
        });
        Styles.Add(new Style(x => x.OfType<Button>())
        {
            Setters = { new Setter(Button.CornerRadiusProperty, new CornerRadius(10)), new Setter(Button.BorderBrushProperty, Ui.Brush("#DCD5C8")), new Setter(Button.BackgroundProperty, Ui.Brush(Ui.Paper)), new Setter(Button.MinHeightProperty, 36d), new Setter(Button.HorizontalContentAlignmentProperty, Avalonia.Layout.HorizontalAlignment.Center), new Setter(Button.VerticalContentAlignmentProperty, Avalonia.Layout.VerticalAlignment.Center) }
        });
        Styles.Add(new Style(x => x.OfType<TextBox>())
        {
            Setters = { new Setter(TextBox.CornerRadiusProperty, new CornerRadius(10)), new Setter(TextBox.BorderBrushProperty, Ui.Brush("#DCD5C8")), new Setter(TextBox.BackgroundProperty, Brushes.White), new Setter(TextBox.PaddingProperty, new Thickness(12, 8)) }
        });
        Styles.Add(new Style(x => x.OfType<TextBox>().PropertyEquals(TextBox.AcceptsReturnProperty, false))
        {
            Setters = { new Setter(TextBox.VerticalContentAlignmentProperty, Avalonia.Layout.VerticalAlignment.Center) }
        });
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop) desktop.MainWindow = new MainWindow();
        base.OnFrameworkInitializationCompleted();
    }
}
