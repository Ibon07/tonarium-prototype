using System.ComponentModel;
using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Platform;
using Avalonia.Threading;

namespace Tonarium.Desktop.ThreeD;

/// <summary>A real child HWND covering the client area; Unity renders beneath the native HUD.</summary>
public sealed class UnitySurface : NativeControlHost
{
    private TaskCompletionSource<IntPtr> ready = NewReady();
    private IntPtr playerWindow;
    private NativeChildFocusBridge? focusBridge;
    private int lastWidth = -1, lastHeight = -1;
    private bool covered;
    private readonly DispatcherTimer resizeTimer;
    public IntPtr Handle { get; private set; }
    public event Action<int, int>? ClientSizeChanged;

    public UnitySurface()
    {
        Focusable = true;
        resizeTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        resizeTimer.Tick += (_, _) => FitPlayer();
        SizeChanged += (_, _) => FitPlayer();
        LayoutUpdated += (_, _) => FitPlayer();
    }

    /// <summary>Completes once Avalonia has attached the surface to its native window.</summary>
    public Task<IntPtr> GetHandleAsync() => Handle != IntPtr.Zero ? Task.FromResult(Handle) : ready.Task;

    /// <summary>Hand keyboard focus to Unity when it locks the movement controls.</summary>
    public bool FocusPlayer()
    {
        if (focusBridge is null) return false;
        focusBridge.ForwardOnHostFocus = true;
        return focusBridge.FocusPlayer();
    }

    public void SetInputLocked(bool locked)
    {
        if (focusBridge is null) return;
        focusBridge.ForwardOnHostFocus = locked;
        if (locked) focusBridge.FocusPlayer();
    }

    public void SetCovered(bool value)
    {
        covered = value;
        IsVisible = !value;
        if (OperatingSystem.IsWindows() && Handle != IntPtr.Zero) Native.ShowWindow(Handle, value ? 0 : 5);
    }

    protected override IPlatformHandle CreateNativeControlCore(IPlatformHandle parent)
    {
        if (!OperatingSystem.IsWindows() || parent.HandleDescriptor != "HWND")
        {
            // Headless and other platforms keep the normal Avalonia placeholder.
            ready.TrySetResult(IntPtr.Zero);
            return base.CreateNativeControlCore(parent);
        }
        const uint childStyles = 0x40000000 | 0x10000000 | 0x04000000 | 0x02000000 | 0x00000004;
        Handle = Native.CreateWindowEx(0, "STATIC", "Tonarium Unity surface", childStyles,
            0, 0, 1, 1, parent.Handle, IntPtr.Zero, Native.GetModuleHandle(null), IntPtr.Zero);
        if (Handle == IntPtr.Zero)
        {
            var error = new Win32Exception(Marshal.GetLastWin32Error(), "Could not create the Unity rendering surface.");
            ready.TrySetException(error);
            throw error;
        }
        focusBridge = new NativeChildFocusBridge(Handle, () => playerWindow);
        ready.TrySetResult(Handle);
        resizeTimer.Start();
        return new PlatformHandle(Handle, "HWND");
    }

    /// <summary>Registers the embedded Unity window and keeps it fitted to this surface.</summary>
    public void ResizePlayer(IntPtr playerHandle)
    {
        playerWindow = playerHandle;
        lastWidth = lastHeight = -1;
        FitPlayer();
        if (focusBridge?.ForwardOnHostFocus == true) focusBridge.FocusPlayer();
    }

    private void FitPlayer()
    {
        if (!OperatingSystem.IsWindows() || Handle == IntPtr.Zero || playerWindow == IntPtr.Zero || !Native.IsWindow(playerWindow)) return;
        // 子 HWND は Avalonia のシートより前に描画されるため、シートの間だけ隠す。
        if (covered) Native.ShowWindow(Handle, 0);
        if (!Native.GetClientRect(Handle, out var rect)) return;
        var width = Math.Max(1, rect.Right - rect.Left); var height = Math.Max(1, rect.Bottom - rect.Top);
        if (width == lastWidth && height == lastHeight) return;
        lastWidth = width; lastHeight = height;
        const uint noZOrderNoActivateShow = 0x0004 | 0x0010 | 0x0040;
        Native.SetWindowPos(playerWindow, IntPtr.Zero, 0, 0, width, height, noZOrderNoActivateShow);
        ClientSizeChanged?.Invoke(width, height);
    }

    protected override void DestroyNativeControlCore(IPlatformHandle control)
    {
        if (OperatingSystem.IsWindows() && Handle != IntPtr.Zero)
        {
            resizeTimer.Stop();
            focusBridge?.Dispose(); focusBridge = null;
            // Keep the external player's window alive if the surface is detached before its process exits.
            if (playerWindow != IntPtr.Zero && Native.IsWindow(playerWindow))
            {
                Native.ShowWindow(playerWindow, 0);
                Native.SetParent(playerWindow, IntPtr.Zero);
            }
            Native.DestroyWindow(Handle);
            Handle = IntPtr.Zero; playerWindow = IntPtr.Zero;
            lastWidth = lastHeight = -1;
            ready = NewReady();
            return;
        }
        base.DestroyNativeControlCore(control);
    }

    private static TaskCompletionSource<IntPtr> NewReady() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
        [DllImport("kernel32.dll", EntryPoint = "GetModuleHandleW", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string? module);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool DestroyWindow(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] internal static extern IntPtr SetParent(IntPtr child, IntPtr parent);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ShowWindow(IntPtr hwnd, int command);
    }
}
