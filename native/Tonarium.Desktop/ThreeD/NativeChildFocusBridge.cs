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
    private static readonly UIntPtr SubclassId = new(0x544E4643);

    /// <summary>Forward host focus only while the player has locked its movement controls.</summary>
    public bool ForwardOnHostFocus { get; set; }

    public NativeChildFocusBridge(IntPtr hostWindow, Func<IntPtr> playerWindow)
    {
        this.playerWindow = playerWindow;
        callback = WindowProcedure;
        if (OperatingSystem.IsWindows() && hostWindow != IntPtr.Zero &&
            Native.SetWindowSubclass(hostWindow, callback, SubclassId, UIntPtr.Zero))
            this.hostWindow = hostWindow;
    }

    public bool FocusPlayer()
    {
        if (!OperatingSystem.IsWindows() || forwarding) return false;
        var player = playerWindow();
        if (player == IntPtr.Zero || !Native.IsWindow(player) || !Native.IsWindowEnabled(player) || !Native.IsWindowVisible(player)) return false;
        var targetThread = Native.GetWindowThreadProcessId(player, out var playerProcess);
        Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out var foregroundProcess);
        // 遅れて届いたIPCで、別アプリへ移動済みのユーザーからフォーカスを奪わない。
        if (foregroundProcess != Environment.ProcessId && foregroundProcess != playerProcess) return false;
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
        ForwardOnHostFocus = false;
        if (hostWindow == IntPtr.Zero) return;
        Native.RemoveWindowSubclass(hostWindow, callback, SubclassId);
        hostWindow = IntPtr.Zero;
    }

    private static class Native
    {
        internal delegate IntPtr SubclassProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);
        [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowSubclass(IntPtr hwnd, SubclassProc callback, UIntPtr id, UIntPtr data);
        [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RemoveWindowSubclass(IntPtr hwnd, SubclassProc callback, UIntPtr id);
        [DllImport("comctl32.dll")] internal static extern IntPtr DefSubclassProc(IntPtr hwnd, uint message, UIntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] internal static extern IntPtr SetFocus(IntPtr hwnd);
        [DllImport("user32.dll")] internal static extern IntPtr GetFocus();
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
        [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool AttachThreadInput(uint first, uint second, [MarshalAs(UnmanagedType.Bool)] bool attach);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowEnabled(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowVisible(IntPtr hwnd);
    }
}
