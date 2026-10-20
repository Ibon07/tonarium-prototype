using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;

/// <summary>Normal native item interactions against the existing authoritative local server.</summary>
internal static class ItemBehaviorProbe
{
    internal static async Task Run(string server, string output, Action<string> pass)
    {
        Directory.CreateDirectory(output);
        // The probe is a separate --items run. Its dice choices never touch personal preferences.
        using var preferences = DesktopInstance.Acquire(Path.Combine(output, "item-preferences"));
        await using var source = new TonariumClient(persistSettings: false);
        await using var peer = new TonariumClient(persistSettings: false);
        await using var sourceMedia = new NativeMedia(source, initialMicrophoneEnabled: false, persistPreferences: false);
        await using var peerMedia = new NativeMedia(peer, initialMicrophoneEnabled: false, persistPreferences: false);
        var owner = new Window { Title = "Native item behavior verification", Width = 900, Height = 760 };
        var windows = new List<ItemWindow>(); var uiErrors = new List<string>();
        var evidence = new JsonArray(); var result = new JsonObject { ["passed"] = false, ["server"] = server, ["checks"] = evidence };
        var suffix = Guid.NewGuid().ToString("N")[..8]; string? session = null; var stage = "connect";
        try
        {
            owner.Show();
            await source.ConnectAsync(server, "Items source " + suffix);
            await peer.ConnectAsync(server, "Items peer " + suffix);
            var sessionName = "Item behavior " + suffix;
            await source.SendAsync(new { t = "sessionCreate", name = sessionName, world = "room", visibility = "public" });
            await Until(() => source.State.Sessions.Any(s => J.Text(s, "name") == sessionName), "temporary session");
            session = J.Text(source.State.Sessions.First(s => J.Text(s, "name") == sessionName), "id");
            await source.JoinAsync(session); await Until(() => source.State.SyncStatus == "connected", "source room connected");
            await peer.JoinAsync(session); await Until(() => peer.State.SyncStatus == "connected", "peer room connected");

            stage = "note-blur-and-echo";
            var noteId = await Spawn("note"); var noteWindow = Open(source, sourceMedia, noteId); await Settle();
            var note = Views<TextBox>(noteWindow).Single(t => t.AcceptsReturn);
            var message = "編集中の付箋 " + suffix + "\n次の行も保持";
            note.Focus(); note.SelectAll(); noteWindow.KeyTextInput(message);
            var swatch = Views<Button>(noteWindow).First(b => b.Width == 18 && b.Height == 18);
            swatch.Focus();
            if (note.IsKeyboardFocusWithin) throw new InvalidOperationException("Note did not lose focus for the blur check.");
            // Normal presence updates can precede the edit echo: they must not reset the just-blurred draft.
            source.State.Touch();
            if (note.Text != message) throw new InvalidOperationException("Blur followed by a room refresh lost the pending note draft.");
            await Until(() => J.Text(source.State.Items[noteId], "text") == message && J.Text(peer.State.Items[noteId], "text") == message, "note echo reaches both clients");
            if (note.Text != message) throw new InvalidOperationException("The authoritative echo replaced the native note with different text.");
            await Capture(noteWindow, "items-note.png");
            Record(stage, new JsonObject { ["sourceText"] = J.Text(source.State.Items[noteId], "text"), ["peerText"] = J.Text(peer.State.Items[noteId], "text") });
            pass("Native note edit survives blur/presence refresh and matches both authoritative echoes");

            stage = "canvas-save-jpeg";
            var canvasId = await Spawn("canvas"); var canvasWindow = Open(source, sourceMedia, canvasId); await Settle();
            var canvas = canvasWindow.GetVisualDescendants().OfType<Control>().Single(c => c.GetType().Name == "SharedDrawingCanvas");
            var start = canvas.TranslatePoint(new Point(60, 90), canvasWindow)!.Value;
            var finish = canvas.TranslatePoint(new Point(220, 170), canvasWindow)!.Value;
            canvasWindow.MouseDown(start, MouseButton.Left); canvasWindow.MouseMove(finish, RawInputModifiers.LeftMouseButton); canvasWindow.MouseUp(finish, MouseButton.Left);
            await Until(() => J.Array(peer.State.Items[canvasId], "strokes").Count > 0, "native stroke reaches peer");
            Click(canvasWindow, "💾 保存");
            await Until(() => peer.State.Chats.Any(c => J.Text(c, "text") == "🎨 キャンバスを保存しました"), "saved canvas image reaches room chat");
            var imageUrl = J.Text(peer.State.Chats.Last(c => J.Text(c, "text") == "🎨 キャンバスを保存しました"), "image");
            const string jpegPrefix = "data:image/jpeg;base64,";
            if (!imageUrl.StartsWith(jpegPrefix, StringComparison.Ordinal)) throw new InvalidOperationException("Canvas export was not JPEG.");
            using (var bytes = new MemoryStream(Convert.FromBase64String(imageUrl[jpegPrefix.Length..])))
            using (var decoded = new System.Drawing.Bitmap(bytes))
            {
                if (decoded.Width != 1240 || decoded.Height != 900) throw new InvalidOperationException($"Canvas export size was {decoded.Width}×{decoded.Height}.");
                var dark = 0; for (var y = 0; y < decoded.Height; y += 4) for (var x = 0; x < decoded.Width; x += 4) { var pixel = decoded.GetPixel(x, y); if (pixel.R + pixel.G + pixel.B < 500) dark++; }
                if (dark == 0) throw new InvalidOperationException("Exported canvas lost the drawn line.");
                Record(stage, new JsonObject { ["mime"] = "image/jpeg", ["width"] = decoded.Width, ["height"] = decoded.Height, ["sampledInkPixels"] = dark });
            }
            await Capture(canvasWindow, "items-canvas.png");
            pass("Native canvas Save publishes a nonempty 1240×900 JPEG to the peer");

            stage = "dice-preference-reopen";
            var diceA = await Spawn("dice"); var diceB = await Spawn("dice");
            var diceWindow = Open(source, sourceMedia, diceA); var otherDiceWindow = Open(source, sourceMedia, diceB); await Settle();
            Click(diceWindow, "d20"); Click(diceWindow, "＋"); Click(diceWindow, "＋");
            Views<CheckBox>(diceWindow).Single().IsChecked = true;
            await Until(() => HasButton(otherDiceWindow, "3d20 を振る") && Views<CheckBox>(otherDiceWindow).Single().IsChecked == true, "dice preferences shared between native windows");
            diceWindow.Close(); diceWindow = Open(source, sourceMedia, diceA); await Settle();
            if (!HasButton(diceWindow, "3d20 を振る") || Views<CheckBox>(diceWindow).Single().IsChecked != true) throw new InvalidOperationException("Reopening dice lost its saved choices.");
            var peerDiceWindow = Open(peer, peerMedia, diceA); await Settle();
            if (!HasButton(peerDiceWindow, "1d6 を振る") || Views<CheckBox>(peerDiceWindow).Single().IsChecked == true) throw new InvalidOperationException("Dice choices leaked into another user's preferences.");
            Click(diceWindow, "3d20 を振る");
            await Until(() => J.Number(source.State.Items[diceA]?["roll"], "sides") == 20 && J.Number(peer.State.Items[diceA]?["roll"], "count") == 3, "saved dice settings produce the requested roll");
            var rollId = J.Text(source.State.Items[diceA]?["roll"], "id");
            await Until(() => source.State.Chats.Any(c => J.Text(c?["dice"], "id") == rollId && J.Array(c?["dice"], "results").Count == 3), "private dice results return to rolling user");
            if (peer.State.Items[diceA]?["roll"]?["results"] is not null || peer.State.Chats.Any(c => J.Text(c?["dice"], "id") == rollId && J.Array(c?["dice"], "results").Count > 0))
                throw new InvalidOperationException("Secret dice results were visible to the peer.");
            Record(stage, new JsonObject { ["sides"] = 20, ["count"] = 3, ["secret"] = true, ["peerDefaultsPreserved"] = true });
            await Capture(diceWindow, "items-dice.png");
            pass("Dice choices persist across windows/reopen, stay per-user, and drive a private 3d20 roll");

            stage = "2048-focused-key";
            var puzzleId = await Spawn("g2048"); var puzzleWindow = Open(source, sourceMedia, puzzleId); await Settle();
            var before = source.State.Items[puzzleId]?["grid"]?.ToJsonString();
            var focusedButton = Views<Button>(puzzleWindow).Single(b => b.Content?.ToString() == "←"); focusedButton.Focus();
            foreach (var (key, physical) in new[] { (Key.Right, PhysicalKey.ArrowRight), (Key.Left, PhysicalKey.ArrowLeft), (Key.Down, PhysicalKey.ArrowDown), (Key.Up, PhysicalKey.ArrowUp) })
            {
                puzzleWindow.KeyPress(key, RawInputModifiers.None, physical, null); puzzleWindow.KeyRelease(key, RawInputModifiers.None, physical, null);
                await Task.Delay(180);
                if (source.State.Items[puzzleId]?["grid"]?.ToJsonString() != before) break;
            }
            await Until(() => source.State.Items[puzzleId]?["grid"]?.ToJsonString() != before && JsonNode.DeepEquals(source.State.Items[puzzleId]?["grid"], peer.State.Items[puzzleId]?["grid"]), "2048 focused button keyboard action reaches peer");
            Record(stage, new JsonObject { ["before"] = JsonNode.Parse(before!), ["after"] = source.State.Items[puzzleId]?["grid"]?.DeepClone() });
            pass("2048 arrow input with a focused native button changes both synchronized boards");

            stage = "hammer-hit-approach";
            var hammerId = await Spawn("hammer"); var hammerWindow = Open(source, sourceMedia, hammerId); await Settle();
            Click(hammerWindow, "手に持つ");
            await Until(() => J.Text(source.State.Items[hammerId], "holder") == source.State.SelfId && J.Text(peer.State.Items[hammerId], "holder") == source.State.SelfId, "native hammer pickup reaches both clients");
            await source.SendRoomAsync(new { t = "place2d", target = source.State.SelfId, pos = new { x = 0, z = 0, ry = 0 } });
            await peer.SendRoomAsync(new { t = "place2d", target = peer.State.SelfId, pos = new { x = 4, z = 0, ry = 0 } });
            await Until(() => Math.Abs(J.Number(source.State.Presence[peer.State.SelfId]?["pos"], "x") - 4) < .01 && Math.Abs(J.Number(source.State.Presence[source.State.SelfId]?["pos"], "x")) < .01, "hammer participants positioned");
            Click(hammerWindow, "槌  " + peer.State.Name);
            await Until(() => peer.State.Notifications.Any(n => J.Text(n, "t") == "hit" && J.Text(n, "from") == source.State.SelfId) &&
                Math.Abs(J.Number(peer.State.Presence[source.State.SelfId]?["pos"], "x") - 3.2) < .01, "hammer hit and native approach reach peer");
            var selfPosition = peer.State.Presence[source.State.SelfId]?["pos"]; var targetPosition = peer.State.Presence[peer.State.SelfId]?["pos"];
            var distance = Math.Sqrt(Math.Pow(J.Number(selfPosition, "x") - J.Number(targetPosition, "x"), 2) + Math.Pow(J.Number(selfPosition, "z") - J.Number(targetPosition, "z"), 2));
            if (Math.Abs(distance - .8) > .01) throw new InvalidOperationException($"Hammer stopped {distance:0.000}m from target.");
            Record(stage, new JsonObject { ["distance"] = distance, ["sourcePosition"] = selfPosition?.DeepClone(), ["targetPosition"] = targetPosition?.DeepClone() });
            pass("Native hammer action hits the peer and approaches to 0.8m");

            stage = "remote-removal-closes-window";
            await peer.SendRoomAsync(new { t = "itemRemove", id = noteId });
            await Until(() => !source.State.Items.ContainsKey(noteId) && !noteWindow.IsVisible, "remote removal closes native item window");
            Record(stage, new JsonObject { ["windowVisible"] = noteWindow.IsVisible });
            pass("Remote item removal closes its native window");
            if (uiErrors.Count > 0) throw new InvalidOperationException(string.Join("; ", uiErrors));
            result["passed"] = true;
        }
        catch (Exception error) { result["error"] = error.ToString(); throw; }
        finally
        {
            result["stage"] = stage; result["session"] = session;
            result["uiErrors"] = new JsonArray(uiErrors.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
            await File.WriteAllTextAsync(Path.Combine(output, "item-behavior.json"), result.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            foreach (var window in windows) window.Close(); owner.Close();
            try { if (peer.State.SessionId is not null) await peer.LeaveAsync(); } catch { }
            try { if (source.State.SessionId is not null) await source.LeaveAsync(); } catch { }
            try
            {
                if (session is not null && source.State.Connected)
                {
                    await source.SendAsync(new { t = "sessionDelete", id = session });
                    await Until(() => !source.State.Sessions.Any(s => J.Text(s, "id") == session), "temporary session removed");
                }
            }
            catch { }
        }

        ItemWindow Open(TonariumClient client, NativeMedia media, string id)
        {
            var window = new ItemWindow(new NativeContext(client, media, owner) { NotificationRequested = uiErrors.Add }, id);
            windows.Add(window); window.Show(owner); return window;
        }
        async Task<string> Spawn(string kind)
        {
            var before = source.State.Items.Select(p => p.Key).ToHashSet();
            // Keep furniture away from the x=0..4,z=0 hammer lane.
            await source.SendRoomAsync(new { t = "itemCreate", kind, x = -6, z = -6 + before.Count * 1.5, ry = 0 });
            await Until(() => source.State.Items.Any(p => !before.Contains(p.Key) && J.Text(p.Value, "kind") == kind), "create " + kind);
            var id = source.State.Items.First(p => !before.Contains(p.Key) && J.Text(p.Value, "kind") == kind).Key;
            await Until(() => peer.State.Items.ContainsKey(id), kind + " reaches peer"); return id;
        }
        void Record(string check, JsonObject details) { details["check"] = check; evidence.Add(details); }
        async Task Capture(Window window, string name) { await Settle(); using var image = window.CaptureRenderedFrame(); image?.Save(Path.Combine(output, name)); }
    }

    private static IEnumerable<T> Views<T>(Visual root) where T : class => root.GetVisualDescendants().OfType<T>();
    private static bool HasButton(Visual root, string label) => Views<Button>(root).Any(b => b.Content?.ToString() == label);
    private static void Click(Visual root, string label)
    {
        var button = Views<Button>(root).Single(b => b.IsEffectivelyVisible && b.IsEnabled && b.Content?.ToString() == label);
        button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    }
    private static async Task Settle() { await Task.Delay(100); AvaloniaHeadlessPlatform.ForceRenderTimerTick(2); }
    private static async Task Until(Func<bool> condition, string label)
    {
        var timeout = Stopwatch.StartNew();
        while (!condition()) { if (timeout.Elapsed.TotalSeconds > 20) throw new TimeoutException(label); await Task.Delay(25); }
    }
}
