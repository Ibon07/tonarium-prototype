using System.Text.Json.Nodes;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;
using Tonarium.Desktop.ThreeD;

internal static class SurvivorProbe
{
    internal static async Task Run(string server, string output, Action<string> pass, bool unity = false)
    {
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "preferences"));
        await using var client = new TonariumClient(persistSettings: false);
        await using var peer = new TonariumClient(persistSettings: false);
        await using var media = new NativeMedia(client, false, false);
        var owner = new Window { Width = 720, Height = 900 };
        var errors = new List<string>();
        var panel = new SurvivorPanel(new NativeContext(client, media, owner) { NotificationRequested = errors.Add });
        var input = new TextBox { PlaceholderText = "入力中は移動しない" };
        var layout = new Grid { RowDefinitions = new RowDefinitions("*,Auto") };
        layout.Children.Add(panel); Grid.SetRow(input, 1); layout.Children.Add(input); owner.Content = layout;
        string? sid = null;
        try
        {
            owner.Show();
            await client.ConnectAsync(server, "Survivor native test");
            await peer.ConnectAsync(server, "Survivor peer test");
            var name = "survivor-native-" + Guid.NewGuid().ToString("N")[..8];
            await client.SendAsync(new { t = "sessionCreate", name, world = "survivors", visibility = "public" });
            await Until(() => client.State.Sessions.Any(s => J.Text(s, "name") == name), "session creation");
            sid = J.Text(client.State.Sessions.First(s => J.Text(s, "name") == name), "id");
            if (sid == "lounge") throw new Exception("Test must not join lounge");
            await client.JoinAsync(sid); await peer.JoinAsync(sid);
            await Until(() => client.State.SyncStatus == "connected" && peer.State.SyncStatus == "connected", "room sync");
            await Until(() => client.State.Survivor.ContainsKey("phase") && client.State.SurvivorProfile.ContainsKey("points"), "snapshot and profile");
            panel.Refresh(); await Settle(); Capture("lobby");
            Click("星詠み");
            await Until(() => J.Text(peer.State.Survivor["stylePicks"], client.State.SelfId) == "stargazer", "style sync");
            Click("参加者でゲーム開始");
            await Until(() => J.Text(client.State.Survivor, "phase") == "running", "start from native button");
            pass("Native lobby button starts a shared run and synchronizes selected style to a second client");
            panel.Refresh(); await Settle();
            var map = panel.GetVisualDescendants().OfType<SurvivorMap>().Single(); panel.Focus();
            var me = () => client.State.Survivor["players"]?[client.State.SelfId];
            var before = J.Number(me(), "x");
            owner.KeyPress(Key.D, RawInputModifiers.None, PhysicalKey.D, null); await Task.Delay(600);
            owner.KeyRelease(Key.D, RawInputModifiers.None, PhysicalKey.D, null);
            await Until(() => J.Number(me(), "x") > before + .4, "2D keyboard movement");
            await Until(() => J.Array(client.State.Survivor, "enemies").Count > 0, "enemy spawn");
            Capture("running");
            pass("2D movement works without clicking the map and receives server-spawned enemies");
            owner.KeyPress(Key.D, RawInputModifiers.None, PhysicalKey.D, null); await Task.Delay(200);
            input.Focus(); await Task.Delay(300); var inputX = J.Number(me(), "x");
            owner.KeyPress(Key.A, RawInputModifiers.None, PhysicalKey.A, "a"); await Task.Delay(300);
            owner.KeyRelease(Key.A, RawInputModifiers.None, PhysicalKey.A, "a");
            owner.KeyRelease(Key.D, RawInputModifiers.None, PhysicalKey.D, null);
            if (Math.Abs(J.Number(me(), "x") - inputX) > .05) throw new Exception("Typing moved player");
            panel.Focus(); await Task.Delay(300);
            if (Math.Abs(J.Number(me(), "x") - inputX) > .05) throw new Exception("Held movement resumed after leaving input");
            pass("Chat input suppresses movement and clears held keys before focus returns");
            // 別セッションの更新が混ざらないことも検査する。
            var current = client.State.Survivor;
            client.ApplyMessage(new JsonObject { ["t"] = "survivor", ["sid"] = "other-session", ["state"] = new JsonObject() });
            if (!ReferenceEquals(current, client.State.Survivor)) throw new Exception("Cross-session survivor state accepted");
            pass("Survivor updates remain isolated to the joined session");
            // サーバーの実戦で経験値を獲得し、UIから装備選択を返す。
            var deadline = DateTime.UtcNow.AddSeconds(100);
            while ((me()?["choiceQueue"] as JsonArray)?.Count is not > 0)
            {
                if (DateTime.UtcNow > deadline || !J.Bool(me(), "alive")) throw new Exception("No level-up before timeout/death");
                await Task.Delay(200);
            }
            await Until(() => client.State.Survivor["pausedAt"] is not null, "shared pause");
            panel.Refresh(); await Settle(); Capture("choice");
            var choice = J.Value(me()!["choiceQueue"]![0]![0]);
            var oldLevel = J.Number(me()!["gear"], choice);
            Click(SurvivorPanel.Name("gear", choice) + "\n");
            await Until(() => J.Number(me()!["gear"], choice) == oldLevel + 1, "gear selection");
            var peerMe = peer.State.Survivor["players"]?[peer.State.SelfId];
            if (peerMe?["choiceQueue"]?[0]?[0] is { } peerChoice) await peer.SendRoomAsync(new { t = "survivorChoose", gear = J.Value(peerChoice) });
            await Until(() => client.State.Survivor["pausedAt"] is null, "resume after all choices");
            pass("Real combat levels up, pauses for every participant, accepts native gear choice and resumes");
            await client.LeaveAsync(); await client.JoinAsync(sid);
            await Until(() => client.State.SyncStatus == "connected" && client.State.Survivor.ContainsKey("phase"), "rejoin snapshot");
            if (errors.Count > 0) throw new Exception(string.Join("; ", errors));
            pass("Rejoin restores the survivor snapshot without UI command errors");
            if (unity)
            {
                await peer.LeaveAsync();
                await Until(() => J.Text(client.State.Survivor, "phase") == "ended", "previous run ends after all participants leave");
                var previousRun = J.Number(client.State.Survivor, "run");
                await using var host = new ThreeDHost(client);
                await host.StartAsync();
                await host.TeleportAsync(0, 6.5, 0);
                await Until(() => client.State.Avatars[client.State.SelfId] is { } av && Math.Abs(J.Number(av, "z") - 6.5) < .3, "Unity join area");
                await client.SendRoomAsync(new { t = "survivorStart" });
                await Until(() => J.Number(client.State.Survivor, "run") > previousRun && J.Bool(client.State.Survivor["players"]?[client.State.SelfId], "alive"), "3D new run");
                await host.TeleportAsync(2, 3, 0);
                await Until(() => Math.Abs(J.Number(client.State.Survivor["players"]?[client.State.SelfId], "x") - 2) < .3, "3D avatar movement reaches combat state");
                if (!host.IsRunning) throw new Exception("Unity exited during survivor run");
                await host.StopAsync();
                if (client.State.Mode != "2d") throw new Exception("3D did not return to 2D");
                pass("Real Unity bridge joins the run, sends avatar movement to combat state and returns to 2D");
            }
        }
        finally
        {
            owner.Close(); await peer.LeaveAsync(); await client.LeaveAsync();
            if (sid is not null) await client.SendAsync(new { t = "sessionDelete", id = sid });
        }
        void Click(string text)
        {
            var button = panel.GetVisualDescendants().OfType<Button>().First(b => b.Content?.ToString()?.Contains(text) == true);
            if (!button.IsEnabled) throw new Exception("Button disabled: " + text);
            button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        }
        void Capture(string name) { AvaloniaHeadlessPlatform.ForceRenderTimerTick(3); using var frame = owner.CaptureRenderedFrame(); frame!.Save(Path.Combine(output, name + ".png")); }
        static async Task Settle() { await Task.Delay(250); AvaloniaHeadlessPlatform.ForceRenderTimerTick(3); }
        static async Task Until(Func<bool> predicate, string reason)
        { var end = DateTime.UtcNow.AddSeconds(30); while (!predicate()) { if (DateTime.UtcNow > end) throw new Exception("Timed out: " + reason); await Task.Delay(100); } }
    }
}
