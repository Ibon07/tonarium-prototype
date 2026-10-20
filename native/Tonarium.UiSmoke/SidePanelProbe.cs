using System.Reflection;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Views;

internal static class SidePanelProbe
{
    internal static async Task Run(string output, Action<string> pass)
    {
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "preferences"));
        NativeSettings.SetBool("room.leftFolded", false); NativeSettings.SetBool("room.rightFolded", false);
        var window = new MainWindow();
        try
        {
            window.Show();
            Call(window, "LoadDemo");
            var client = Field<TonariumClient>(window, "client");
            client.State.SessionId = "lounge"; client.State.Mode = "3d";
            typeof(MainWindow).GetField("previousSession", BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(window, "lounge");
            Call(window, "Refresh");
            var room = Field<RoomView>(window, "room"); room.SetExternalScene(true);
            var left = Field<Border>(room, "_left"); var right = Field<Border>(room, "_right");
            await Settle(); Capture("visible");
            var leftX = Position(left).X; var rightX = Position(right).X;
            Field<Button>(room, "_mic").Focus();
            room.SetWorldInputLocked(true);
            Tab(); await Settle();
            if (!room.SidePanelsStowed || Position(left).X + left.Bounds.Width > 1 || Position(right).X < window.ClientSize.Width - 1)
                throw new Exception($"Panels did not leave the viewport: {Position(left)} / {Position(right)}");
            if (!Field<Button>(room, "_leftFold").IsVisible || !Field<Button>(room, "_rightFold").IsVisible) throw new Exception("Restore handles disappeared.");
            Capture("stowed"); pass("Tab slides both side panels outside the viewport and retains restore handles");
            if (!Field<bool>(room, "_worldInputLocked")) throw new Exception("Tab released the world input lock.");
            pass("Tab retains the 3D world input lock");
            Tab(); await Settle();
            if (room.SidePanelsStowed || Math.Abs(Position(left).X - leftX) > 1 || Math.Abs(Position(right).X - rightX) > 1) throw new Exception("Tab did not restore panels.");
            pass("Second Tab restores both panels without changing fold preferences");
            room.SetWorldInputLocked(false);
            Field<TextBox>(room, "_input").Focus(); Tab(); await Settle();
            if (room.SidePanelsStowed) throw new Exception("Chat Tab unexpectedly toggled panels.");
            pass("Tab in chat keeps normal keyboard focus behavior");
            Field<Button>(room, "_mic").Focus(); Tab(); await Settle(); room.SetExternalScene(false); await Settle();
            if (room.SidePanelsStowed || NativeSettings.GetBool("room.leftFolded") || NativeSettings.GetBool("room.rightFolded")) throw new Exception("Returning to 2D retained the temporary state.");
            pass("Returning to 2D clears the temporary state and retains saved panel settings");

            Point Position(Control panel) => panel.TranslatePoint(default, window)!.Value;
            void Tab() { window.KeyPress(Key.Tab, RawInputModifiers.None, PhysicalKey.Tab, null); window.KeyRelease(Key.Tab, RawInputModifiers.None, PhysicalKey.Tab, null); }
            void Capture(string name) { using var frame = window.CaptureRenderedFrame(); frame!.Save(Path.Combine(output, name + ".png")); }
        }
        finally { window.Close(); }
    }
    static T Field<T>(object target, string name) => (T)target.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(target)!;
    static void Call(object target, string name) => target.GetType().GetMethod(name, BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(target, null);
    static async Task Settle() { await Task.Delay(280); AvaloniaHeadlessPlatform.ForceRenderTimerTick(4); }
}
