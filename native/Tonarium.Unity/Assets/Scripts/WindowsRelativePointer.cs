using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class WindowsRelativePointer : IDisposable
    {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        const uint WmInput = 0x00FF, WmNcDestroy = 0x0082, WmDisplayChange = 0x007E;
        const uint RidInput = 0x10000003, RidevRemove = 0x00000001, RidevInputSink = 0x00000100, RidevExInputSink = 0x00001000;
        const ushort MouseAbsolute = 0x0001, MouseVirtualDesktop = 0x0002;
        static readonly Dictionary<UIntPtr, WindowsRelativePointer> Roots = new Dictionary<UIntPtr, WindowsRelativePointer>();
        static uint nextId;
        readonly object deltaGate = new object();
        readonly Native.SubclassProc procedure;
        readonly IntPtr window;
        readonly uint threadId;
        readonly UIntPtr subclassId;
        readonly uint disposeMessage;
        readonly uint headerSize = (uint)(8 + IntPtr.Size * 2);
        IntPtr rawBuffer;
        uint rawCapacity = 1024;
        Native.RawInputDevice previous, installed;
        bool hadPrevious, registered, requested, disposed, disposeRequested;
        bool hasAbsolute, absoluteVirtualDesktop;
        IntPtr absoluteDevice;
        double absoluteX, absoluteY, deltaX, deltaY;
        int virtualLeft, virtualTop, virtualWidth, virtualHeight, screenWidth, screenHeight;
#endif
        public bool IsActive { get; private set; }
        public static string LastCreateError { get; private set; }
        public string LastError { get; private set; }
        public long PacketsReceived { get; private set; }
        public long PacketsIgnored { get; private set; }
        public bool LastPacketWasAbsolute { get; private set; }

        public static bool TryCreate(out WindowsRelativePointer pointer, IntPtr preferredWindow = default(IntPtr))
        {
            pointer = null;
            LastCreateError = null;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            if (Application.platform != RuntimePlatform.WindowsPlayer)
            {
                LastCreateError = "Relative pointer requires WindowsPlayer; platform=" + Application.platform;
                return false;
            }
            try
            {
            uint pid = Native.GetCurrentProcessId(), currentThread = Native.GetCurrentThreadId();
            IntPtr found = IntPtr.Zero;
            var candidates = new StringBuilder();
            long largestArea = 0;
            // 同名の隠し補助ウィンドウを避けるため、親が埋め込んだHWNDを優先する。
            if (preferredWindow != IntPtr.Zero)
            {
                uint candidatePid;
                uint candidateThread = Native.GetWindowThreadProcessId(preferredWindow, out candidatePid);
                var name = new StringBuilder(128);
                Native.GetClassName(preferredWindow, name, name.Capacity);
                Native.Rect rect;
                bool hasRect = Native.GetClientRect(preferredWindow, out rect);
                bool visible = Native.IsWindowVisible(preferredWindow);
                if (!Native.IsWindow(preferredWindow) || candidatePid != pid || candidateThread != currentThread
                    || name.ToString().IndexOf("UnityWndClass", StringComparison.OrdinalIgnoreCase) < 0
                    || !visible || !hasRect || rect.Right <= rect.Left || rect.Bottom <= rect.Top)
                {
                    LastCreateError = "Invalid preferred Unity window; HWND=0x" + preferredWindow.ToInt64().ToString("X")
                        + " pid=" + candidatePid + "/" + pid + " ownerThread=" + candidateThread + "/" + currentThread
                        + " class=" + name + " visible=" + visible + " client=" + (rect.Right - rect.Left) + "x" + (rect.Bottom - rect.Top);
                    return false;
                }
                found = preferredWindow;
            }
            else
            {
            Native.EnumProc inspect = (candidate, state) =>
            {
                uint candidatePid;
                uint candidateThread = Native.GetWindowThreadProcessId(candidate, out candidatePid);
                if (candidatePid != pid) return true;
                var name = new StringBuilder(128);
                Native.GetClassName(candidate, name, name.Capacity);
                if (name.ToString().IndexOf("UnityWndClass", StringComparison.OrdinalIgnoreCase) < 0) return true;
                Native.Rect rect;
                bool hasRect = Native.GetClientRect(candidate, out rect);
                bool visible = Native.IsWindowVisible(candidate);
                long area = hasRect ? (long)Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top) : 0;
                candidates.Append(" HWND=0x").Append(candidate.ToInt64().ToString("X")).Append(" ownerThread=").Append(candidateThread)
                    .Append(" visible=").Append(visible).Append(" client=").Append(rect.Right - rect.Left).Append('x').Append(rect.Bottom - rect.Top);
                if (candidateThread == currentThread && visible && area > largestArea) { found = candidate; largestArea = area; }
                return true;
            };
            Native.EnumProc topLevel = (candidate, state) =>
            {
                inspect(candidate, state);
                Native.EnumChildWindows(candidate, inspect, IntPtr.Zero);
                return true;
            };
            Native.EnumWindows(topLevel, IntPtr.Zero);
            }
            if (found == IntPtr.Zero)
            {
                LastCreateError = (candidates.Length == 0 ? "No UnityWndClass in this process;" : "No visible nonempty Unity window on caller thread;")
                    + " pid=" + pid + " callerThread=" + currentThread + candidates;
                return false;
            }
            var result = new WindowsRelativePointer(found, currentThread);
            if (!Native.SetWindowSubclass(found, result.procedure, result.subclassId, UIntPtr.Zero))
            {
                LastCreateError = "SetWindowSubclass failed; error=" + Marshal.GetLastWin32Error()
                    + " HWND=0x" + found.ToInt64().ToString("X") + " callerThread=" + currentThread;
                Marshal.FreeHGlobal(result.rawBuffer);
                result.rawBuffer = IntPtr.Zero;
                return false;
            }
            // ネイティブ側は関数ポインターだけ保持するため、解除までデリゲートを生存させる。
            lock (Roots) Roots[result.subclassId] = result;
            pointer = result;
            return true;
            }
            catch (Exception error)
            {
                LastCreateError = "Relative pointer creation failed: " + error.GetType().Name + ": " + error.Message;
                return false;
            }
#else
            LastCreateError = "Relative pointer is not compiled for this platform.";
            return false;
#endif
        }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        WindowsRelativePointer(IntPtr target, uint ownerThread)
        {
            window = target;
            threadId = ownerThread;
            subclassId = new UIntPtr(++nextId);
            disposeMessage = Native.RegisterWindowMessage("Tonarium.RelativePointer.Dispose");
            rawBuffer = Marshal.AllocHGlobal((int)rawCapacity);
            procedure = WindowMessage;
            RefreshDisplayMetrics();
        }
#else
        WindowsRelativePointer() { }
#endif

        public bool SetLocked(bool locked)
        {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            if (disposed || disposeRequested) { LastError = "Relative pointer is disposed."; return false; }
            if (Native.GetCurrentThreadId() != threadId)
            {
                LastError = "SetLocked thread mismatch; caller=" + Native.GetCurrentThreadId() + " windowOwner=" + threadId;
                return false;
            }
            requested = locked;
            UpdateActivation();
            if (locked && !IsActive && LastError == null)
                LastError = "Relative pointer inactive; foregroundRoot=0x" + Native.GetAncestor(Native.GetForegroundWindow(), 2).ToInt64().ToString("X")
                    + " windowRoot=0x" + Native.GetAncestor(window, 2).ToInt64().ToString("X");
            return IsActive;
#else
            return false;
#endif
        }

        public bool TryConsume(out Vector2 delta)
        {
            delta = Vector2.zero;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            if (disposed || disposeRequested || Native.GetCurrentThreadId() != threadId) return false;
            UpdateActivation();
            lock (deltaGate)
            {
                if (!IsActive) { deltaX = deltaY = 0; return false; }
                delta = new Vector2((float)deltaX, (float)deltaY);
                deltaX = deltaY = 0;
            }
            // 入力がないフレームも成功扱いにし、Unity側の同じ入力を二重適用しない。
            return true;
#else
            return false;
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
        bool OwnsForeground()
        {
            IntPtr foreground = Native.GetForegroundWindow();
            return foreground != IntPtr.Zero && Native.GetAncestor(foreground, 2) == Native.GetAncestor(window, 2);
        }

        void UpdateActivation()
        {
            bool shouldRegister = requested && Native.IsWindow(window) && OwnsForeground();
            if (shouldRegister && !registered) InstallRegistration();
            else if (!shouldRegister && registered) RestoreRegistration();
            IsActive = shouldRegister && registered;
        }

        void InstallRegistration()
        {
            Native.RawInputDevice saved;
            bool existed;
            if (!ReadMouseRegistration(out saved, out existed)) return;
            var replacement = new Native.RawInputDevice
            {
                UsagePage = 1, Usage = 2, Target = window,
                Flags = ((existed ? saved.Flags : 0) & ~RidevExInputSink) | RidevInputSink
            };
            if (!Native.RegisterRawInputDevices(new[] { replacement }, 1, (uint)Marshal.SizeOf(typeof(Native.RawInputDevice))))
            {
                LastError = "RegisterRawInputDevices: " + Marshal.GetLastWin32Error();
                return;
            }
            previous = saved;
            hadPrevious = existed;
            installed = replacement;
            registered = true;
            IsActive = true;
            LastError = null;
            ResetDelta();
            RefreshDisplayMetrics();
        }

        void RestoreRegistration()
        {
            IsActive = false;
            ResetDelta();
            if (!registered) return;
            Native.RawInputDevice current;
            bool exists;
            if (!ReadMouseRegistration(out current, out exists)) return;
            // フォーカス移動でUnityが登録し直していた場合は、その新しい登録を維持する。
            if (exists && current.Target == installed.Target && current.Flags == installed.Flags)
            {
                var restore = hadPrevious ? previous : new Native.RawInputDevice { UsagePage = 1, Usage = 2, Flags = RidevRemove, Target = IntPtr.Zero };
                if (!Native.RegisterRawInputDevices(new[] { restore }, 1, (uint)Marshal.SizeOf(typeof(Native.RawInputDevice))))
                {
                    LastError = "RestoreRawInputDevices: " + Marshal.GetLastWin32Error();
                    return;
                }
            }
            registered = false;
        }

        bool ReadMouseRegistration(out Native.RawInputDevice mouse, out bool found)
        {
            mouse = default(Native.RawInputDevice); found = false;
            uint count = 0, size = (uint)Marshal.SizeOf(typeof(Native.RawInputDevice));
            uint query = Native.GetRegisteredRawInputDevices(null, ref count, size);
            if (query == uint.MaxValue && Marshal.GetLastWin32Error() != 122)
            {
                LastError = "GetRegisteredRawInputDevices: " + Marshal.GetLastWin32Error(); return false;
            }
            if (count == 0) return true;
            var devices = new Native.RawInputDevice[count];
            uint actual = Native.GetRegisteredRawInputDevices(devices, ref count, size);
            if (actual == uint.MaxValue)
            {
                LastError = "GetRegisteredRawInputDevices: " + Marshal.GetLastWin32Error(); return false;
            }
            for (int i = 0; i < actual; i++)
                if (devices[i].UsagePage == 1 && devices[i].Usage == 2) { mouse = devices[i]; found = true; break; }
            return true;
        }

        IntPtr WindowMessage(IntPtr target, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data)
        {
            try
            {
                if (message == WmInput && registered && !disposed)
                {
                    if (requested && OwnsForeground()) ReadPacket(lParam);
                    else { PacketsIgnored++; UpdateActivation(); }
                }
                else if (message == WmDisplayChange) RefreshDisplayMetrics();
                else if (message == WmNcDestroy || (message == disposeMessage && unchecked((ulong)wParam.ToInt64()) == subclassId.ToUInt64())) Close();
            }
            catch (Exception error) { LastError = error.GetType().Name + ": " + error.Message; IsActive = false; }
            // Unity自身の処理と、DefWindowProcによるWM_INPUTの後処理も通す。
            return Native.DefSubclassProc(target, message, wParam, lParam);
        }

        void ReadPacket(IntPtr handle)
        {
            uint length = rawCapacity;
            uint result = Native.GetRawInputData(handle, RidInput, rawBuffer, ref length, headerSize);
            if (result == uint.MaxValue)
            {
                uint required = 0;
                if (Native.GetRawInputData(handle, RidInput, IntPtr.Zero, ref required, headerSize) == uint.MaxValue || required <= rawCapacity || required > 1024 * 1024) return;
                rawCapacity = Math.Max(rawCapacity * 2, required);
                rawBuffer = Marshal.ReAllocHGlobal(rawBuffer, new IntPtr(rawCapacity));
                length = rawCapacity;
                result = Native.GetRawInputData(handle, RidInput, rawBuffer, ref length, headerSize);
            }
            if (result == uint.MaxValue || result < headerSize + 24 || Marshal.ReadInt32(rawBuffer, 0) != 0) return;
            PacketsReceived++;
            int start = (int)headerSize;
            ushort flags = unchecked((ushort)Marshal.ReadInt16(rawBuffer, start));
            int x = Marshal.ReadInt32(rawBuffer, start + 12), y = Marshal.ReadInt32(rawBuffer, start + 16);
            LastPacketWasAbsolute = (flags & MouseAbsolute) != 0;
            if (LastPacketWasAbsolute)
            {
                IntPtr device = Marshal.ReadIntPtr(rawBuffer, 8);
                bool virtualDesktop = (flags & MouseVirtualDesktop) != 0;
                double px = (virtualDesktop ? virtualLeft : 0) + x / 65535.0 * ((virtualDesktop ? virtualWidth : screenWidth) - 1);
                double py = (virtualDesktop ? virtualTop : 0) + y / 65535.0 * ((virtualDesktop ? virtualHeight : screenHeight) - 1);
                lock (deltaGate)
                {
                    if (hasAbsolute && absoluteDevice == device && absoluteVirtualDesktop == virtualDesktop) { deltaX += px - absoluteX; deltaY += py - absoluteY; }
                    absoluteX = px; absoluteY = py; absoluteDevice = device; absoluteVirtualDesktop = virtualDesktop; hasAbsolute = true;
                }
            }
            else
            {
                lock (deltaGate) { deltaX += x; deltaY += y; hasAbsolute = false; }
            }
        }

        void RefreshDisplayMetrics()
        {
            screenWidth = Math.Max(1, Native.GetSystemMetrics(0)); screenHeight = Math.Max(1, Native.GetSystemMetrics(1));
            virtualLeft = Native.GetSystemMetrics(76); virtualTop = Native.GetSystemMetrics(77);
            virtualWidth = Math.Max(1, Native.GetSystemMetrics(78)); virtualHeight = Math.Max(1, Native.GetSystemMetrics(79));
            hasAbsolute = false;
        }

        void ResetDelta() { lock (deltaGate) { deltaX = deltaY = 0; hasAbsolute = false; } }

        void Close()
        {
            if (disposed) return;
            requested = false;
            RestoreRegistration();
            disposed = true; IsActive = false;
            Native.RemoveWindowSubclass(window, procedure, subclassId);
            if (rawBuffer != IntPtr.Zero) { Marshal.FreeHGlobal(rawBuffer); rawBuffer = IntPtr.Zero; }
            lock (Roots) Roots.Remove(subclassId);
        }

        static class Native
        {
            [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
            [StructLayout(LayoutKind.Sequential)] internal struct RawInputDevice { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
            [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate bool EnumProc(IntPtr window, IntPtr state);
            [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate IntPtr SubclassProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);
            [DllImport("kernel32.dll")] internal static extern uint GetCurrentProcessId();
            [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EnumWindows(EnumProc callback, IntPtr state);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr state);
            [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int count);
            [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr window, uint flags);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(IntPtr window);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowVisible(IntPtr window);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClientRect(IntPtr window, out Rect rect);
            [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
            [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern uint RegisterWindowMessage(string message);
            [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
            [DllImport("comctl32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetWindowSubclass(IntPtr window, SubclassProc callback, UIntPtr id, UIntPtr data);
            [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RemoveWindowSubclass(IntPtr window, SubclassProc callback, UIntPtr id);
            [DllImport("comctl32.dll")] internal static extern IntPtr DefSubclassProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
            [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool RegisterRawInputDevices([In] RawInputDevice[] devices, uint count, uint size);
            [DllImport("user32.dll", SetLastError = true)] internal static extern uint GetRegisteredRawInputDevices([Out] RawInputDevice[] devices, ref uint count, uint size);
            [DllImport("user32.dll", SetLastError = true)] internal static extern uint GetRawInputData(IntPtr handle, uint command, IntPtr buffer, ref uint size, uint headerSize);
        }
#endif
    }
}
