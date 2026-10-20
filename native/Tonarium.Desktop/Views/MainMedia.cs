using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Presenters;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed partial class MainWindow
{
    private readonly Border mediaDropHint = new()
    {
        IsVisible = false, IsHitTestVisible = false, Background = Ui.Brush("#DAF8F5EF"),
        BorderBrush = Ui.Brush("#2F5FC4"), BorderThickness = new Thickness(3), CornerRadius = new(20), Margin = new(16),
        Child = new TextBlock { Text = "ここにドロップして共有\n画像・動画・YouTubeリンク", FontSize = 24,
            Foreground = Ui.Brush("#2F5FC4"), TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }
    };

    private void ConfigureMediaInput()
    {
        root.Children.Insert(root.Children.Count - 1, mediaDropHint);
        foreach (var target in new InputElement[] { this, root })
        {
            DragDrop.SetAllowDrop(target, true);
            target.AddHandler(DragDrop.DragOverEvent, MediaDragOver);
            target.AddHandler(DragDrop.DragLeaveEvent, (_, _) => SetMediaDropHint(false));
            target.AddHandler(DragDrop.DropEvent, MediaDrop);
            target.AddHandler(KeyDownEvent, MediaPaste, RoutingStrategies.Tunnel);
        }
    }

    private bool RoomMediaActive => client.State.SessionId is not null && !context.HomeIsOpen && room is not null;

    private void MediaPaste(object? sender, KeyEventArgs e)
    {
        if (e.Handled || !RoomMediaActive || e.KeyModifiers.HasFlag(KeyModifiers.Alt) || !((e.Key == Key.V && e.KeyModifiers.HasFlag(KeyModifiers.Control)) ||
            (e.Key == Key.Insert && e.KeyModifiers.HasFlag(KeyModifiers.Shift)))) return;
        var control = e.Source as Control;
        var input = control as TextBox ?? control?.GetVisualAncestors().OfType<TextBox>().FirstOrDefault();
        if (input?.GetVisualDescendants().OfType<TextPresenter>().Any(p => !string.IsNullOrEmpty(p.PreeditText)) == true) return;
        e.Handled = true;
        RunMediaInput(() => room!.PasteMediaAsync(input));
    }

    private void MediaDragOver(object? sender, DragEventArgs e)
    {
        if (e.Handled || !RoomMediaActive) return;
        var formats = e.DataTransfer.Formats;
        var supported = formats.Contains(DataFormat.File) || formats.Contains(DataFormat.Bitmap) ||
            MediaInput.ReadDrop(e.DataTransfer).YouTubeId is not null;
        if (!supported) return;
        e.DragEffects = DragDropEffects.Copy; e.Handled = true; SetMediaDropHint(true);
    }

    private void MediaDrop(object? sender, DragEventArgs e)
    {
        SetMediaDropHint(false);
        if (e.Handled || !RoomMediaActive) return;
        var content = MediaInput.ReadDrop(e.DataTransfer);
        if (!content.HasMedia && content.YouTubeId is null) return;
        e.DragEffects = DragDropEffects.Copy; e.Handled = true;
        ReleaseWorldInput();
        RunMediaInput(() => room!.DropMediaAsync(content));
    }

    private void SetMediaDropHint(bool visible)
    {
        if (mediaDropHint.IsVisible == visible) return;
        mediaDropHint.IsVisible = visible; threeDOverlay?.RefreshRegion();
    }

    private async void RunMediaInput(Func<Task> action)
    {
        try { await action(); }
        catch (Exception error) { Notify(error.Message); Program.Log(error.ToString()); }
    }
}
