using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;

internal static class SurvivorLayoutProbe
{
    internal static async Task Run(string output, Action<string> pass)
    {
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "layout-preferences"));
        NativeSettings.SetBool("room.leftFolded", false); NativeSettings.SetBool("room.rightFolded", false);
        await using var client = new TonariumClient(persistSettings: false);
        await using var media = new NativeMedia(client, false, false);
        var state = client.State;
        state.SessionId = "survivor-layout"; state.World = "survivors"; state.Mode = "2d";
        state.Users = new JsonArray(new JsonObject { ["id"] = state.SelfId, ["name"] = "Layout test", ["session"] = state.SessionId, ["mode"] = "2d" });
        state.Presence[state.SelfId] = new JsonObject { ["pos"] = new JsonObject { ["x"] = 0, ["z"] = 6.5 } };
        state.Survivor = new JsonObject { ["run"] = 0, ["phase"] = "lobby", ["players"] = new JsonObject(), ["enemies"] = new JsonArray(), ["stylePicks"] = new JsonObject() };
        state.SurvivorProfile = new JsonObject { ["points"] = 0, ["upgrades"] = new JsonObject(), ["discovered"] = new JsonArray(), ["achievements"] = new JsonArray() };
        var window = new Window { Width = 1360, Height = 880 };
        var room = new RoomView(new NativeContext(client, media, window)); window.Content = room;
        try
        {
            window.Show(); await Settle();
            var panel = room.GetVisualDescendants().OfType<SurvivorPanel>().Single();
            foreach (var (width, height) in new[] { (1360, 880), (1000, 640) })
            {
                window.Width = width; window.Height = height; room.Refresh(); await Settle();
                var position = panel.TranslatePoint(default, window)!.Value;
                if (!panel.IsEffectivelyVisible || panel.Bounds.Width < 300 || panel.Bounds.Height < 400) throw new Exception($"Unusable survivor panel at {width}: {panel.Bounds}");
                var start = Buttons().First(b => b.Content?.ToString()?.StartsWith("参加者でゲーム開始") == true);
                if (!start.IsEnabled) throw new Exception("Join-circle start disabled");
                start.BringIntoView(); await Settle();
                var scrollView = panel.GetVisualDescendants().OfType<ScrollViewer>().First();
                if (scrollView.Extent.Width > scrollView.Viewport.Width + 1) throw new Exception("Game panel overflows horizontally");
                foreach (var button in Buttons())
                    if (button.Bounds.Width > panel.Bounds.Width) throw new Exception($"Button extends beyond survivor panel: {button.Content}");
                using var frame = window.CaptureRenderedFrame(); frame!.Save(Path.Combine(output, $"room-{width}.png"));
            }
            pass("RoomView provides the Web panel map, scrollable start action and three-column cards at 1360x880 and 1000x640 without horizontal overflow");
            state.Presence[state.SelfId]!["pos"] = new JsonObject { ["x"] = 8, ["z"] = -8 }; room.Refresh(); await Settle();
            if (Buttons().First(b => b.Content?.ToString()?.StartsWith("参加者でゲーム開始") == true).IsEnabled || !panel.GetVisualDescendants().OfType<TextBlock>().Any(t => t.Text == "参加エリアの輪の中に入ると参加できます"))
                throw new Exception("Join eligibility ignored authoritative presence position");
            pass("Presence positions outside the join circle disable start and show the Web join-circle guidance");

            var libraryButton = Buttons().First(b => b.Content?.ToString() == "装備図鑑・実績を開く");
            var scroll = panel.GetVisualDescendants().OfType<ScrollViewer>().First(); await Settle(); scroll.Offset = new Vector(0, 250); await Settle();
            var offset = scroll.Offset;
            for (var i = 0; i < 3; i++) { state.Survivor["kills"] = i; room.Refresh(); await Task.Delay(200); }
            if (!ReferenceEquals(libraryButton, Buttons().First(b => b.Content?.ToString() == "装備図鑑・実績を開く")) || Math.Abs(scroll.Offset.Y - offset.Y) > 1)
                throw new Exception("Realtime state replaced controls or reset scrolling");
            pass("Realtime state retains scrolling and controls while the library opens in its own window");

            state.Mode = "3d"; room.SetExternalScene(true); room.Refresh(); await Settle();
            if (panel.IsEffectivelyVisible) throw new Exception("2D survivor controls cover the Unity scene");
            state.Mode = "2d"; room.SetExternalScene(false); room.Refresh(); await Settle();
            if (!panel.IsEffectivelyVisible) throw new Exception("2D survivor controls did not return");
            pass("Switching to Unity hides the 2D survivor panel and returning restores it");
            state.Survivor = JsonNode.Parse("""
            {"run":1,"phase":"boss","startedAt":0,"players":{},"enemies":[
              {"kind":"boss","x":0,"z":-6,"hp":500,"maxHp":1000},
              {"kind":"knight","x":-4,"z":-3},{"kind":"bat","x":4,"z":-3},{"kind":"wisp","x":0,"z":3}],"effects":[]}
            """)!.AsObject();
            var me = JsonNode.Parse("""{"id":"self","x":0,"z":0,"alive":true,"level":4,"hp":50,"maxHp":100,"xp":5,"nextXp":20,"gear":{"starbolt":2},"choiceQueue":[["moonblade","shade","starbolt"]]}""")!.AsObject();
            me["id"] = state.SelfId; state.Survivor["players"]![state.SelfId] = me;
            state.Survivor["pausedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            room.Refresh(); await Settle();
            var text = string.Join("\n", panel.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));
            if (!text.Contains("新たな力を選ぶ") || !text.Contains("シナジー:") || !text.Contains("夜の王 · 500 / 1,000")) throw new Exception("Web choice/boss details missing");
            if (panel.GetVisualDescendants().OfType<Avalonia.Controls.Primitives.UniformGrid>().Single().Columns != 3) throw new Exception("Choice cards are not three columns");
            pass("Web-equivalent boss health, paused level-up cards, rarity and synergy details are present");
            var mapControl = panel.GetVisualDescendants().OfType<SurvivorMap>().Single();
            byte[] RenderMap(string filename)
            {
                using var bitmap = new RenderTargetBitmap(new PixelSize(320, 320)); bitmap.Render(mapControl);
                using var bytes = new MemoryStream(); bitmap.Save(bytes);
                File.WriteAllBytes(Path.Combine(output, filename), bytes.ToArray()); return bytes.ToArray();
            }
            var empty = RenderMap("map-no-effects.png");
            foreach (var gear in new[] { "moonblade", "eclipse", "bloodaura", "crimsonsun", "starbolt", "starfall", "shade", "umbralstorm" })
            {
                state.Survivor["effects"] = new JsonArray(new JsonObject { ["gear"] = gear, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 250, ["reach"] = 3, ["from"] = new JsonObject { ["x"] = 0, ["z"] = 0 }, ["targets"] = new JsonArray(new JsonObject { ["x"] = 4, ["z"] = -3 }) });
                if (RenderMap("map-" + gear + ".png").SequenceEqual(empty)) throw new Exception("Weapon effect invisible: " + gear);
                state.Survivor["effects"]![0]!["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 1000;
                if (!RenderMap("map-expired-" + gear + ".png").SequenceEqual(empty)) throw new Exception("Expired weapon effect remains: " + gear);
            }
            pass("All eight Web weapon effects render visibly and expire after the shared 650ms lifetime");

            IEnumerable<Button> Buttons() => panel.GetVisualDescendants().OfType<Button>();
        }
        finally { window.Close(); }
    }
    private static async Task Settle() { await Task.Delay(260); AvaloniaHeadlessPlatform.ForceRenderTimerTick(3); }
}
