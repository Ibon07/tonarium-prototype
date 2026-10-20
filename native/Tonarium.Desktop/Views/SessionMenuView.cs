using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed class SessionMenuView : UserControl
{
    readonly NativeContext context;
    readonly Button button;
    readonly HomeView navigation;
    readonly Popup popup;
    readonly DispatcherTimer dismiss = new() { Interval = TimeSpan.FromMilliseconds(180) };

    public SessionMenuView(NativeContext context)
    {
        this.context = context;
        button = Ui.Button("", () => { CloseNavigation(); context.ShowHome("toggle"); });
        button.Content = new WebIcon("menu", 20);
        button.Width = button.Height = 44; button.Padding = default;
        button.Background = Ui.Brush(Ui.Paper); button.BorderThickness = default;
        button.CornerRadius = new CornerRadius(14);
        Avalonia.Automation.AutomationProperties.SetName(button, "メニュー");
        ToolTip.SetTip(button, "メニュー（最後に開いたページを開く）");
        navigation = new HomeView(context, page => { CloseNavigation(); context.ShowHome(page); });
        navigation.Width = 228;
        popup = new Popup
        {
            Child = navigation, PlacementTarget = button,
            Placement = PlacementMode.BottomEdgeAlignedLeft,
            HorizontalOffset = -8, VerticalOffset = 8,
            // ホバーのポップアップに入力を捕捉させると、元のメニューボタンのクリックが消える。
            IsLightDismissEnabled = false
        };
        var root = new Grid(); root.Children.Add(button); root.Children.Add(popup); Content = root;
        button.PointerEntered += (_, _) => OpenNavigation();
        button.PointerExited += (_, _) => dismiss.Start();
        navigation.PointerEntered += (_, _) => dismiss.Stop();
        navigation.PointerExited += (_, _) => dismiss.Start();
        dismiss.Tick += (_, _) => CloseNavigation();
        DetachedFromVisualTree += (_, _) => CloseNavigation();
        KeyDown += (_, e) => { if (e.Key == Key.Escape) { CloseNavigation(); e.Handled = true; } };
    }

    public void OpenNavigation()
    {
        dismiss.Stop();
        if (context.HomeIsOpen || context.State.SessionId is null) return;
        navigation.Height = Math.Min(680, Math.Max(360, context.Owner.ClientSize.Height - 100));
        navigation.Refresh(); popup.IsOpen = true;
    }

    public void CloseNavigation() { dismiss.Stop(); popup.IsOpen = false; }
    public void Refresh() { if (popup.IsOpen) navigation.Refresh(); }
}
