using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class WindowsMediaInput : IDisposable
    {
        public static string LastCreateError { get; private set; }
        public string LastError { get; private set; }
        public bool IsActive { get; private set; }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        const uint WmDropFiles = 0x0233, WmNcDestroy = 0x0082;
        const int ExtendedStyle = -20, AcceptFilesStyle = 0x00000010;
        static readonly Dictionary<UIntPtr, WindowsMediaInput> Roots = new Dictionary<UIntPtr, WindowsMediaInput>();
        static uint nextId;
        readonly IntPtr window;
        readonly uint threadId, disposeMessage;
        readonly UIntPtr subclassId;
        readonly Native.SubclassProc procedure;
        readonly Action<string[]> onDrop;
        readonly bool acceptedFilesBefore;
        bool disposed, disposeRequested;

        WindowsMediaInput(IntPtr target, uint ownerThread, Action<string[]> callback)
        {
            window = target; threadId = ownerThread; onDrop = callback;
            subclassId = new UIntPtr(++nextId); procedure = WindowMessage;
            disposeMessage = Native.RegisterWindowMessage("Tonarium.MediaInput.Dispose");
            acceptedFilesBefore = (Native.GetExtendedStyle(window) & AcceptFilesStyle) != 0;
        }
#else
        WindowsMediaInput() { }
#endif

        public static bool TryCreate(IntPtr hwnd, Action<string[]> onDrop, out WindowsMediaInput input)
        {
            input = null; LastCreateError = null;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            if (Application.platform != RuntimePlatform.WindowsPlayer || onDrop == null)
            {
                LastCreateError = "WindowsPlayer and a drop callback are required."; return false;
            }
            WindowsMediaInput result = null;
            try
            {
                uint processId;
                uint ownerThread = Native.GetWindowThreadProcessId(hwnd, out processId);
                uint callerThread = Native.GetCurrentThreadId();
                var name = new StringBuilder(128); Native.GetClassName(hwnd, name, name.Capacity);
                if (!Native.IsWindow(hwnd) || processId != Native.GetCurrentProcessId() || ownerThread != callerThread
                    || name.ToString().IndexOf("UnityWndClass", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    LastCreateError = "Invalid Unity drop window; HWND=0x" + hwnd.ToInt64().ToString("X")
                        + " pid=" + processId + " ownerThread=" + ownerThread + " callerThread=" + callerThread + " class=" + name;
                    return false;
                }
                result = new WindowsMediaInput(hwnd, ownerThread, onDrop);
                if (!Native.SetWindowSubclass(hwnd, result.procedure, result.subclassId, UIntPtr.Zero))
                {
                    LastCreateError = "Drop SetWindowSubclass failed: " + Marshal.GetLastWin32Error(); return false;
                }
                // 解除までデリゲートを保持し、相対マウス入力とは別のサブクラスとして登録する。
                lock (Roots) Roots[result.subclassId] = result;
                Native.DragAcceptFiles(hwnd, true);
                if ((Native.GetExtendedStyle(hwnd) & AcceptFilesStyle) == 0)
                {
                    LastCreateError = "DragAcceptFiles did not enable file drops."; result.Close(); return false;
                }
                result.IsActive = true; input = result; return true;
            }
            catch (Exception error)
            {
                LastCreateError = "Drop registration failed: " + error.GetType().Name + ": " + error.Message;
                if (result != null) result.Close(); return false;
            }
#else
            LastCreateError = "Windows file drops are unavailable on this platform."; return false;
#endif
        }

        public void Dispose()
        {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            if (disposed || disposeRequested) return;
            disposeRequested = true;
            if (Native.GetCurrentThreadId() == threadId) Close();
            else if (disposeMessage != 0) Native.PostMessage(window, disposeMessage, new IntPtr(unchecked((long)subclassId.ToUInt64())), IntPtr.Zero);
#endif
        }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        IntPtr WindowMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data)
        {
            if (message == WmDropFiles && !disposed)
            {
                try { if (!disposeRequested) ReceiveDrop(wParam); }
                catch (Exception error) { LastError = "Drop failed: " + error.GetType().Name + ": " + error.Message; }
                finally { if (wParam != IntPtr.Zero) Native.DragFinish(wParam); }
                // HDROPはここで解放済みなので、別の受信処理へ渡さない。
                return IntPtr.Zero;
            }
            if (message == WmNcDestroy || message == disposeMessage && unchecked((ulong)wParam.ToInt64()) == subclassId.ToUInt64()) Close();
            return Native.DefSubclassProc(hwnd, message, wParam, lParam);
        }

        void ReceiveDrop(IntPtr drop)
        {
            if (drop == IntPtr.Zero) return;
            uint count = Math.Min(5u, Native.DragQueryFile(drop, uint.MaxValue, null, 0));
            var files = new List<string>((int)count);
            for (uint i = 0; i < count; i++)
            {
                uint length = Native.DragQueryFile(drop, i, null, 0);
                if (length == 0 || length > 32767) continue;
                var path = new StringBuilder((int)length + 1);
                if (Native.DragQueryFile(drop, i, path, (uint)path.Capacity) > 0) files.Add(path.ToString());
            }
            if (files.Count > 0) { LastError = null; onDrop(files.ToArray()); }
        }

        void Close()
        {
            if (disposed) return;
            IsActive = false;
            if (Native.IsWindow(window) && !acceptedFilesBefore) Native.DragAcceptFiles(window, false);
            if (!Native.RemoveWindowSubclass(window, procedure, subclassId) && Native.IsWindow(window))
            {
                LastError = "Drop RemoveWindowSubclass failed: " + Marshal.GetLastWin32Error();
                // ネイティブ側が参照している間はデリゲートを破棄しない。
                return;
            }
            disposed = true;
            lock (Roots) Roots.Remove(subclassId);
        }

        static class Native
        {
            [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate IntPtr SubclassProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);
            [DllImport("kernel32.dll")] internal static extern uint GetCurrentProcessId();
            [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
            [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int count);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(IntPtr window);
            [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);
            [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong32(IntPtr window, int index);
            internal static long GetExtendedStyle(IntPtr window) => IntPtr.Size == 8 ? GetWindowLongPtr64(window, ExtendedStyle).ToInt64() : GetWindowLong32(window, ExtendedStyle);
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern uint RegisterWindowMessage(string message);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
            [DllImport("comctl32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowSubclass(IntPtr window, SubclassProc callback, UIntPtr id, UIntPtr data);
            [DllImport("comctl32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RemoveWindowSubclass(IntPtr window, SubclassProc callback, UIntPtr id);
            [DllImport("comctl32.dll")] internal static extern IntPtr DefSubclassProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
            [DllImport("shell32.dll")] internal static extern void DragAcceptFiles(IntPtr window, [MarshalAs(UnmanagedType.Bool)] bool accept);
            [DllImport("shell32.dll", EntryPoint = "DragQueryFileW", CharSet = CharSet.Unicode)] internal static extern uint DragQueryFile(IntPtr drop, uint index, StringBuilder fileName, uint count);
            [DllImport("shell32.dll")] internal static extern void DragFinish(IntPtr drop);
        }
#endif
    }
}
