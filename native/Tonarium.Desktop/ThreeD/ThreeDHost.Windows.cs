using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Avalonia.Threading;

namespace Tonarium.Desktop.ThreeD;

public sealed partial class ThreeDHost
{
    public IntPtr PlayerWindowHandle { get; private set; }
    public event Action<IntPtr>? PlayerWindowChanged;

    private async Task EmbedPlayerAsync(IntPtr parentWindow, CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows() || player is null) return;
        int pid = player.Id;
        IntPtr window = IntPtr.Zero;
        for (int attempt = 0; attempt < 100 && window == IntPtr.Zero; attempt++)
        {
            window = FindPlayerWindow(pid, parentWindow);
            if (window == IntPtr.Zero) await Task.Delay(50, ct);
        }
        if (window == IntPtr.Zero) throw new IOException("Unity の描画ウィンドウを検出できませんでした。");
        int renderWidth = 1280, renderHeight = 800;
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            ct.ThrowIfCancellationRequested();
            long style = Win32.GetWindowLongPtr(window, -16).ToInt64();
            style = (style & ~(0x80000000L | 0x00C00000L | 0x00040000L | 0x00080000L | 0x00010000L | 0x00020000L)) | 0x40000000L | 0x10000000L;
            Win32.SetWindowLongPtr(window, -16, new IntPtr(style));
            long exStyle = Win32.GetWindowLongPtr(window, -20).ToInt64() & ~0x00040000L;
            Win32.SetWindowLongPtr(window, -20, new IntPtr(exStyle));
            Marshal.SetLastPInvokeError(0);
            if (Win32.SetParent(window, parentWindow) == IntPtr.Zero && Marshal.GetLastPInvokeError() != 0)
                throw new Win32Exception(Marshal.GetLastPInvokeError());
            Win32.GetClientRect(parentWindow, out var bounds);
            renderWidth = Math.Max(1, bounds.Right); renderHeight = Math.Max(1, bounds.Bottom);
            Win32.SetWindowPos(window, IntPtr.Zero, 0, 0, Math.Max(1, bounds.Right), Math.Max(1, bounds.Bottom), 0x0020 | 0x0040 | 0x0004);
            Win32.ShowWindow(window, 5);
            PlayerWindowHandle = window;
            PlayerWindowChanged?.Invoke(window);
        });
        await ResizeAsync(renderWidth, renderHeight);
    }

    private static IntPtr FindPlayerWindow(int processId, IntPtr parent)
    {
        IntPtr found = IntPtr.Zero;
        Win32.EnumWindowsProc inspect = (handle, _) =>
        {
            Win32.GetWindowThreadProcessId(handle, out uint id);
            if (id != processId) return true;
            var name = new StringBuilder(256); Win32.GetClassName(handle, name, name.Capacity);
            if (!name.ToString().Contains("UnityWndClass", StringComparison.OrdinalIgnoreCase)) return true;
            found = handle; return false;
        };
        Win32.EnumChildWindows(parent, inspect, IntPtr.Zero);
        if (found == IntPtr.Zero) Win32.EnumWindows(inspect, IntPtr.Zero);
        return found;
    }

    private static class Win32
    {
        internal delegate bool EnumWindowsProc(IntPtr window, IntPtr state);
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
        [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] internal static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
        [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] internal static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
        [DllImport("user32.dll", SetLastError=true)] internal static extern IntPtr SetParent(IntPtr window, IntPtr parent);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClientRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ShowWindow(IntPtr window, int command);
    }
}
