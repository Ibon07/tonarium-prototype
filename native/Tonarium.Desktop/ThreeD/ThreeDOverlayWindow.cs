using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;

namespace Tonarium.Desktop.ThreeD;

/// <summary>Keeps the native room controls above Unity without copying its rendered frames.</summary>
public sealed class ThreeDOverlayWindow : Window
{
    private readonly Window ownerWindow;
    private readonly Func<IReadOnlyList<Rect>?> regions;
    private bool closed, updatingBounds, updateQueued, shown, allowClose;
    private bool inputLocked;
    private readonly Native.SubclassProc inputCallback;
    private IntPtr inputHookWindow;
    private static readonly UIntPtr InputSubclassId = new(0x544E4F49);
    private string regionSignature = "";

    /// <param name="regions">HUD rectangles in this window's client DIP coordinates; null covers the whole client, an empty list passes all input to Unity.</param>
    public ThreeDOverlayWindow(Window owner, Control content, Func<IReadOnlyList<Rect>?> regions)
    {
        ownerWindow = owner;
        this.regions = regions;
        inputCallback = InputWindowProcedure;
        Title = owner.Title;
        Content = content;
        Background = Brushes.Transparent;
        TransparencyLevelHint = [WindowTransparencyLevel.Transparent];
        WindowDecorations = WindowDecorations.None;
        WindowStartupLocation = WindowStartupLocation.Manual;
        CanResize = false;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = false;
        MinWidth = MinHeight = 1;
        owner.PositionChanged += OwnerPositionChanged;
        owner.SizeChanged += OwnerSizeChanged;
        owner.ScalingChanged += OwnerScalingChanged;
        owner.PropertyChanged += OwnerPropertyChanged;
        owner.Closed += OwnerClosed;
        LayoutUpdated += (_, _) => RefreshRegion();
        ScalingChanged += (_, _) => { regionSignature = ""; RefreshRegion(); };
        Opened += (_, _) => { ApplyInputMode(); SynchronizeBounds(); RefreshRegion(); };
        Closing += (_, e) =>
        {
            if (allowClose) return;
            // HUDにフォーカスがある時のAlt+F4もアプリ全体の終了として扱う。
            e.Cancel = true;
            ownerWindow.Close();
        };
        Closed += (_, _) => DetachOwner();
    }

    public void ShowForOwner()
    {
        if (closed) return;
        SynchronizeBounds();
        if (!ownerWindow.IsVisible || ownerWindow.WindowState == WindowState.Minimized) return;
        if (!IsVisible) Show(ownerWindow);
        shown = true;
        SynchronizeBounds();
        RefreshRegion();
    }

    /// <summary>Recalculate after a panel is folded, a toast appears, or a full-screen sheet opens.</summary>
    public void RefreshRegion()
    {
        if (closed || updateQueued) return;
        updateQueued = true;
        Dispatcher.UIThread.Post(() =>
        {
            updateQueued = false;
            if (!closed) ApplyRegion();
        }, DispatcherPriority.Render);
    }

    /// <summary>Keep drawing the HUD while all pointer and activation input goes to Unity.</summary>
    public void SetInputLocked(bool locked)
    {
        if (closed || inputLocked == locked) return;
        inputLocked = locked;
        IsHitTestVisible = !locked;
        ApplyInputMode();
    }

    private void ApplyInputMode()
    {
        var hwnd = Hwnd(this);
        if (hwnd == IntPtr.Zero) return;
        if (inputHookWindow == IntPtr.Zero && Native.SetWindowSubclass(hwnd, inputCallback, InputSubclassId, UIntPtr.Zero)) inputHookWindow = hwnd;
        const long transparent = 0x20, noActivate = 0x08000000;
        var style = Native.GetWindowLongPtr(hwnd, -20).ToInt64();
        style = inputLocked ? style | transparent | noActivate : style & ~(transparent | noActivate);
        Native.SetWindowLongPtr(hwnd, -20, new IntPtr(style));
        Native.SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020);
    }

    private IntPtr InputWindowProcedure(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data)
    {
        // 領域は描画用に残す。ロック中のHUDがカーソルやフォーカスを奪わないよう入力だけ通す。
        if (inputLocked && message == 0x0084) return new IntPtr(-1); // HTTRANSPARENT
        if (inputLocked && message == 0x0021) return new IntPtr(3); // MA_NOACTIVATE
        return Native.DefSubclassProc(hwnd, message, wParam, lParam);
    }

    /// <summary>Return the same control tree to the main window when leaving 3D.</summary>
    public Control? CloseAndDetach()
    {
        var content = Content as Control;
        Content = null;
        allowClose = true;
        Close();
        return content;
    }

    private void OwnerPositionChanged(object? sender, PixelPointEventArgs e) => SynchronizeBounds();
    private void OwnerSizeChanged(object? sender, SizeChangedEventArgs e) => SynchronizeBounds();
    private void OwnerScalingChanged(object? sender, EventArgs e)
    {
        regionSignature = "";
        SynchronizeBounds();
    }

    private void OwnerPropertyChanged(object? sender, AvaloniaPropertyChangedEventArgs e)
    {
        if (e.Property != WindowStateProperty && e.Property != IsVisibleProperty) return;
        if (!ownerWindow.IsVisible || ownerWindow.WindowState == WindowState.Minimized)
        {
            if (IsVisible) Hide();
            return;
        }
        if (shown) ShowForOwner();
    }

    private void OwnerClosed(object? sender, EventArgs e) { allowClose = true; Close(); }

    private void SynchronizeBounds()
    {
        if (closed || updatingBounds) return;
        updatingBounds = true;
        try
        {
            var position = ownerWindow.PointToScreen(default);
            if (Position != position) Position = position;
            var size = ownerWindow.ClientSize;
            if (Math.Abs(Width - size.Width) > .1) Width = Math.Max(1, size.Width);
            if (Math.Abs(Height - size.Height) > .1) Height = Math.Max(1, size.Height);
            // DIP 丸めで1pxずれるとUnityの縁が露出するため、最後に物理ピクセルで一致させる。
            var ownerHwnd = Hwnd(ownerWindow);
            var overlayHwnd = Hwnd(this);
            if (ownerHwnd != IntPtr.Zero && overlayHwnd != IntPtr.Zero && Native.GetClientRect(ownerHwnd, out var bounds))
                Native.SetWindowPos(overlayHwnd, IntPtr.Zero, position.X, position.Y,
                    Math.Max(1, bounds.Right), Math.Max(1, bounds.Bottom), 0x0004 | 0x0010);
            RefreshRegion();
        }
        finally { updatingBounds = false; }
    }

    private void ApplyRegion()
    {
        var hwnd = Hwnd(this);
        if (hwnd == IntPtr.Zero || !IsVisible || !Native.GetClientRect(hwnd, out var client)) return;
        var scale = RenderScaling;
        var requested = regions();
        var bounds = new Rect(0, 0, client.Right, client.Bottom);
        var physical = requested?.Where(r => r.Width > 0 && r.Height > 0)
            .Select(r => new Rect(Math.Floor((r.X - 6) * scale), Math.Floor((r.Y - 6) * scale),
                Math.Ceiling((r.Width + 12) * scale), Math.Ceiling((r.Height + 12) * scale)).Intersect(bounds))
            .Where(r => r.Width > 0 && r.Height > 0).ToArray();
        var signature = $"{client.Right},{client.Bottom},{scale}:" + (physical is null ? "full" : string.Join(";", physical));
        if (signature == regionSignature) return;

        var region = Native.CreateRectRgn(0, 0, 0, 0);
        if (region == IntPtr.Zero) return;
        try
        {
            if (physical is null)
            {
                Native.DeleteObject(region);
                region = Native.CreateRectRgn(0, 0, client.Right, client.Bottom);
            }
            else
            {
                // HWNDそのものをパネル部分だけに切る。空間部分の入力は別プロセスのUnityへ直接届く。
                foreach (var rect in physical)
                {
                    var round = Math.Max(1, (int)Math.Round(16 * scale));
                    var part = Native.CreateRoundRectRgn((int)rect.Left, (int)rect.Top,
                        (int)rect.Right + 1, (int)rect.Bottom + 1, round, round);
                    if (part == IntPtr.Zero) continue;
                    Native.CombineRgn(region, region, part, 2);
                    Native.DeleteObject(part);
                }
            }
            // 成功後のHRGNはWindows所有になるため解放しない。
            if (Native.SetWindowRgn(hwnd, region, true) != 0) { region = IntPtr.Zero; regionSignature = signature; }
        }
        finally { if (region != IntPtr.Zero) Native.DeleteObject(region); }
    }

    private void DetachOwner()
    {
        if (closed) return;
        closed = true;
        if (inputHookWindow != IntPtr.Zero) Native.RemoveWindowSubclass(inputHookWindow, inputCallback, InputSubclassId);
        inputHookWindow = IntPtr.Zero;
        ownerWindow.PositionChanged -= OwnerPositionChanged;
        ownerWindow.SizeChanged -= OwnerSizeChanged;
        ownerWindow.ScalingChanged -= OwnerScalingChanged;
        ownerWindow.PropertyChanged -= OwnerPropertyChanged;
        ownerWindow.Closed -= OwnerClosed;
    }

    private static IntPtr Hwnd(Window window)
    {
        if (!OperatingSystem.IsWindows()) return IntPtr.Zero;
        var handle = window.TryGetPlatformHandle();
        return handle?.HandleDescriptor == "HWND" ? handle.Handle : IntPtr.Zero;
    }

    private static class Native
    {
        internal delegate IntPtr SubclassProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);
        [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowSubclass(IntPtr hwnd, SubclassProc callback, UIntPtr id, UIntPtr data);
        [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RemoveWindowSubclass(IntPtr hwnd, SubclassProc callback, UIntPtr id);
        [DllImport("comctl32.dll")] internal static extern IntPtr DefSubclassProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] internal static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] internal static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClientRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] internal static extern int SetWindowRgn(IntPtr window, IntPtr region, [MarshalAs(UnmanagedType.Bool)] bool redraw);
        [DllImport("gdi32.dll")] internal static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
        [DllImport("gdi32.dll")] internal static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight);
        [DllImport("gdi32.dll")] internal static extern int CombineRgn(IntPtr destination, IntPtr source1, IntPtr source2, int combineMode);
        [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool DeleteObject(IntPtr value);
    }
}
