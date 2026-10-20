using System.Runtime.InteropServices;
using Avalonia.Threading;

namespace Tonarium.Desktop.ThreeD;

/// <summary>Direct keyboard input to the embedded player instead of its focusable STATIC host.</summary>
public sealed class NativeChildFocusBridge : IDisposable
{
    private readonly Func<IntPtr> playerWindow;
    private readonly Native.SubclassProc callback;
    private IntPtr hostWindow;
    private bool forwarding;
    private bool clipped;
    private Native.Rect lastClip;
    private readonly DispatcherTimer pointerTimer;
    private static readonly UIntPtr SubclassId = new(0x544E4643);

    /// <summary>Forward host focus only while the player has locked its movement controls.</summary>
    public bool ForwardOnHostFocus { get; set; }
    public event Action? InputCaptureLost;

    public NativeChildFocusBridge(IntPtr hostWindow, Func<IntPtr> playerWindow)
    {
        this.playerWindow = playerWindow;
        callback = WindowProcedure;
        pointerTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        pointerTimer.Tick += (_, _) => UpdatePointerClip();
        if (OperatingSystem.IsWindows() && hostWindow != IntPtr.Zero &&
            Native.SetWindowSubclass(hostWindow, callback, SubclassId, UIntPtr.Zero))
            this.hostWindow = hostWindow;
    }

    public void SetInputLocked(bool locked)
    {
        ForwardOnHostFocus = locked;
        if (!locked)
        {
            pointerTimer.Stop();
            ReleasePointerClip();
            return;
        }
        FocusPlayer();
        UpdatePointerClip();
        if (ForwardOnHostFocus) pointerTimer.Start();
    }

    public bool FocusPlayer()
    {
        if (!OperatingSystem.IsWindows() || forwarding) return false;
        var player = playerWindow();
        if (player == IntPtr.Zero || !Native.IsWindow(player) || !Native.IsWindowEnabled(player) || !Native.IsWindowVisible(player)) return false;
        var targetThread = Native.GetWindowThreadProcessId(player, out _);
        // 遅れて届いたIPCで、別アプリへ移動済みのユーザーからフォーカスを奪わない。
        if (!PlayerIsForeground(player)) return false;
        if (Native.GetFocus() == player) return true;
        var currentThread = Native.GetCurrentThreadId();
        var attached = false;
        forwarding = true;
        try
        {
            if (currentThread != targetThread)
            {
                attached = Native.AttachThreadInput(currentThread, targetThread, true);
                if (!attached) return false;
            }
            Native.SetFocus(player);
            return Native.GetFocus() == player;
        }
        finally
        {
            // 入力キューの結合を残すと、片方の処理停止が他方のUIにも伝わる。
            if (attached) Native.AttachThreadInput(currentThread, targetThread, false);
            forwarding = false;
        }
    }

    private void UpdatePointerClip()
    {
        if (!OperatingSystem.IsWindows() || !ForwardOnHostFocus) { ReleasePointerClip(); return; }
        var player = playerWindow();
        var root = player == IntPtr.Zero ? IntPtr.Zero : Native.GetAncestor(player, 2);
        var thread = Native.GetWindowThreadProcessId(player, out _);
        var info = new Native.GuiThreadInfo { Size = (uint)Marshal.SizeOf<Native.GuiThreadInfo>() };
        var ownsFocus = Native.GetGUIThreadInfo(thread, ref info) && (info.Focus == player || Native.IsChild(player, info.Focus));
        if (player == IntPtr.Zero || !Native.IsWindowVisible(player) || !Native.IsWindowEnabled(player) ||
            Native.IsIconic(root) || !PlayerIsForeground(player) || !ownsFocus)
        {
            ForwardOnHostFocus = false;
            pointerTimer.Stop();
            ReleasePointerClip();
            InputCaptureLost?.Invoke();
            return;
        }
        if (!Native.GetClientRect(player, out var rect) || rect.Right < 2 || rect.Bottom < 2) return;
        var origin = new Native.Point();
        if (!Native.ClientToScreen(player, ref origin)) return;
        rect.Left += origin.X; rect.Right += origin.X; rect.Top += origin.Y; rect.Bottom += origin.Y;
        // Unityの描画HWNDの範囲に限定し、別モニターやネイティブHUDへ抜けるのを防ぐ。
        if (!Native.GetClipCursor(out var current) || !current.Equals(rect))
            clipped = Native.ClipCursor(ref rect);
        else clipped = true;
        lastClip = rect;
    }

    private void ReleasePointerClip()
    {
        if (!clipped) return;
        // 他アプリが新しい制限を取得済みなら、そのClipCursorには触らない。
        if (Native.GetClipCursor(out var current) && current.Equals(lastClip)) Native.ClearClipCursor(IntPtr.Zero);
        clipped = false;
    }

    private static bool PlayerIsForeground(IntPtr player)
    {
        var foreground = Native.GetForegroundWindow();
        return foreground != IntPtr.Zero && Native.GetAncestor(player, 2) == foreground;
    }

    private IntPtr WindowProcedure(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data)
    {
        var result = Native.DefSubclassProc(hwnd, message, wParam, lParam);
        if (message == 0x0007 && ForwardOnHostFocus && !forwarding)
        {
            // WM_SETFOCUS処理中の再入を避け、親のフォーカス更新が終わってから子へ渡す。
            Dispatcher.UIThread.Post(() => { if (hostWindow != IntPtr.Zero && ForwardOnHostFocus) FocusPlayer(); }, DispatcherPriority.Input);
        }
        if (message == 0x0082) Dispose();
        return result;
    }

    public void Dispose()
    {
        SetInputLocked(false);
        if (hostWindow == IntPtr.Zero) return;
        Native.RemoveWindowSubclass(hostWindow, callback, SubclassId);
        hostWindow = IntPtr.Zero;
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] internal struct GuiThreadInfo
        {
            public uint Size, Flags;
            public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
            public Rect CaretBounds;
        }
        internal delegate IntPtr SubclassProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);
        [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowSubclass(IntPtr hwnd, SubclassProc callback, UIntPtr id, UIntPtr data);
        [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RemoveWindowSubclass(IntPtr hwnd, SubclassProc callback, UIntPtr id);
        [DllImport("comctl32.dll")] internal static extern IntPtr DefSubclassProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] internal static extern IntPtr SetFocus(IntPtr hwnd);
        [DllImport("user32.dll")] internal static extern IntPtr GetFocus();
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
        [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsChild(IntPtr parent, IntPtr child);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClipCursor(out Rect rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ClipCursor(ref Rect rect);
        [DllImport("user32.dll", EntryPoint = "ClipCursor")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ClearClipCursor(IntPtr rect);
        [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool AttachThreadInput(uint first, uint second, [MarshalAs(UnmanagedType.Bool)] bool attach);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowEnabled(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowVisible(IntPtr hwnd);
    }
}
