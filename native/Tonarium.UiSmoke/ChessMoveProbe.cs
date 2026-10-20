using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;

/// <summary>Real native chess buttons against the existing authoritative server.</summary>
internal static class ChessMoveProbe
{
    internal static async Task Run(string server, string output, Action<string> pass, string? unityProbe = null)
    {
        await using var source = new TonariumClient(persistSettings: false);
        await using var peer = new TonariumClient(persistSettings: false);
        await using var sourceMedia = new NativeMedia(source, initialMicrophoneEnabled: false, persistPreferences: false);
        await using var peerMedia = new NativeMedia(peer, initialMicrophoneEnabled: false, persistPreferences: false);
        var evidence = new JsonArray();
        var result = new JsonObject { ["passed"] = false, ["server"] = server, ["checks"] = evidence };
        var owner = new Window { Width = 900, Height = 820, Title = "Chess input verification" };
        var windows = new List<ItemWindow>();
        var errors = new List<string>();
        var unique = Guid.NewGuid().ToString("N")[..8];
        string? session = null, item = null;
        string stage = "connect";
        try
        {
            Directory.CreateDirectory(output);
            owner.Show();
            await source.ConnectAsync(server, "Chess source " + unique);
            await peer.ConnectAsync(server, "Chess peer " + unique);
            var sessionName = "Chess UI " + unique;
            await source.SendAsync(new { t = "sessionCreate", name = sessionName, world = "room", visibility = "public" });
            await Until(() => source.State.Sessions.Any(s => J.Text(s, "name") == sessionName), "temporary chess session");
            session = J.Text(source.State.Sessions.First(s => J.Text(s, "name") == sessionName), "id");
            result["session"] = session;
            await source.JoinAsync(session);
            await Until(() => source.State.SyncStatus == "connected", "source chess client connected", ConnectionDetails);
            await peer.JoinAsync(session);
            await Until(() => peer.State.SyncStatus == "connected", "peer chess client connected", ConnectionDetails);
            await source.SendRoomAsync(new { t = "itemCreate", kind = "chess", x = 1, z = 1, ry = 0 });
            await Until(() => source.State.Items.Any(i => J.Text(i.Value, "kind") == "chess") && peer.State.Items.Any(i => J.Text(i.Value, "kind") == "chess"), "chess board received");
            item = source.State.Items.First(i => J.Text(i.Value, "kind") == "chess").Key;
            result["session"] = session; result["item"] = item;
            var sourceWindow = Open(source, sourceMedia, item);
            var peerWindow = Open(peer, peerMedia, item);
            await Settle(); Record("initial-board");

            await Move(sourceWindow, 52, 36, "wP", "e4", 1, "white-e2-e4");
            await Move(peerWindow, 12, 28, "bP", "e5", 2, "black-e7-e5");
            await Move(sourceWindow, 62, 45, "wN", "Nf3", 3, "white-g1-f3");

            stage = "two-click-reset";
            var beforeReset = Revision(source);
            ClickReset(peerWindow); await Settle();
            if (Revision(source) != beforeReset || Revision(peer) != beforeReset)
                throw new InvalidOperationException("The first reset click must only ask for confirmation.");
            ClickReset(peerWindow);
            await Until(() => Reset(source) && Reset(peer), "reset reaches both clients");
            Record(stage); pass("Native chess reset confirmation restores both synchronized boards");

            if (unityProbe is not null)
            {
                stage = "actual-unity-action";
                var probe = JsonNode.Parse(await File.ReadAllTextAsync(unityProbe));
                var action = probe?["emitted"]?[0]?["message"]?["action"]?.DeepClone() as JsonObject
                    ?? throw new InvalidOperationException("Unity probe has no emitted chess action.");
                if (J.Text(action, "a") != "chessMove" || J.Number(action, "from") != 52 || J.Number(action, "to") != 36)
                    throw new InvalidOperationException("Unity probe must contain its actual e2-e4 action.");
                var previous = Revision(source); action["revision"] = previous;
                await source.SendRoomAsync(new { t = "itemAction", id = item, action });
                await Until(() => Accepted(source) && Accepted(peer), "actual Unity chess JSON accepted by the real server");
                evidence.Add(new JsonObject { ["check"] = stage, ["action"] = action.DeepClone(), ["source"] = source.State.Items[item]?.DeepClone(), ["peer"] = peer.State.Items[item]?.DeepClone() });
                pass("Actual Unity chess JSON moves e2-e4 on both native clients");
                bool Accepted(TonariumClient client) => Revision(client) == previous + 1 &&
                    client.State.Items[item]?["board"]?[52] is null && client.State.Items[item]?["board"]?[36]?.ToString() == "wP" &&
                    client.State.Items[item]?["chess"]?["moves"] is JsonArray { Count: 1 } moves && moves[0]?.ToString() == "e4";
            }

            // This repository's chess AI runs locally on the server and needs no external engine.
            stage = "chess-ai";
            await source.SendRoomAsync(new { t = "itemCreate", kind = "chessAi", x = 2, z = 1, ry = 0 });
            await Until(() => source.State.Items.Any(i => J.Text(i.Value, "kind") == "chessAi") && peer.State.Items.Any(i => J.Text(i.Value, "kind") == "chessAi"), "AI board received");
            var ai = source.State.Items.First(i => J.Text(i.Value, "kind") == "chessAi").Key;
            var aiWindow = Open(source, sourceMedia, ai); await Settle();
            ClickSquare(aiWindow, 52); ClickSquare(aiWindow, 36);
            await Until(() => source.State.Items[ai]?["chess"]?["moves"] is JsonArray { Count: >= 2 } &&
                peer.State.Items[ai]?["chess"]?["moves"] is JsonArray { Count: >= 2 }, "AI replies to real native e2-e4 input");
            if (!JsonNode.DeepEquals(source.State.Items[ai]?["chess"], peer.State.Items[ai]?["chess"]))
                throw new InvalidOperationException("AI boards differ across native clients.");
            evidence.Add(new JsonObject { ["check"] = "chess-ai-white-move-and-reply", ["source"] = source.State.Items[ai]?.DeepClone(), ["peer"] = peer.State.Items[ai]?.DeepClone() });
            pass("Native chess AI accepts white input and synchronizes its black reply");
            result["passed"] = true;

            bool Reset(TonariumClient client) => Revision(client) == beforeReset + 1 &&
                client.State.Items[item]?["chess"]?["moves"] is JsonArray { Count: 0 } &&
                client.State.Items[item]?["board"]?[52]?.ToString() == "wP" &&
                client.State.Items[item]?["board"]?[12]?.ToString() == "bP" &&
                client.State.Items[item]?["board"]?[62]?.ToString() == "wN";
        }
        catch (Exception ex) { result["error"] = ex.Message; throw; }
        finally
        {
            result["stage"] = stage;
            result["connectionDetails"] = ConnectionDetails();
            if (item is not null) { result["finalSource"] = source.State.Items[item]?.DeepClone(); result["finalPeer"] = peer.State.Items[item]?.DeepClone(); }
            result["uiErrors"] = new JsonArray(errors.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output, "chess-moves.json"), result.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            foreach (var window in windows) window.Close();
            owner.Close();
            if (peer.State.SessionId is not null) await peer.LeaveAsync();
            if (source.State.SessionId is not null) await source.LeaveAsync();
            if (session is not null && source.State.Connected) await source.SendAsync(new { t = "sessionDelete", id = session });
        }

        ItemWindow Open(TonariumClient client, NativeMedia media, string id)
        {
            var context = new NativeContext(client, media, owner) { NotificationRequested = errors.Add };
            var window = new ItemWindow(context, id); windows.Add(window); window.Show(owner); return window;
        }
        long Revision(TonariumClient client) => (long)J.Number(client.State.Items[item!]?["chess"], "revision");
        string ConnectionDetails() => $"source home={source.State.ConnectionStatus} sync={source.State.SyncStatus} session={source.State.SessionId} error={source.State.LastError}; peer home={peer.State.ConnectionStatus} sync={peer.State.SyncStatus} session={peer.State.SessionId} error={peer.State.LastError}";
        void Record(string label) => evidence.Add(new JsonObject { ["check"] = label, ["source"] = source.State.Items[item!]?.DeepClone(), ["peer"] = peer.State.Items[item!]?.DeepClone() });
        async Task Move(ItemWindow window, int from, int to, string piece, string notation, int moveCount, string label)
        {
            stage = label; var previous = Revision(source);
            ClickSquare(window, from); ClickSquare(window, to);
            await Until(() => Matches(source) && Matches(peer), label + " changes source and peer board/revision/SAN");
            if (!JsonNode.DeepEquals(source.State.Items[item!]?["chess"], peer.State.Items[item!]?["chess"]))
                throw new InvalidOperationException(label + ": source/peer chess state mismatch.");
            Record(label); await Settle();
            using (var image = window.CaptureRenderedFrame()) image?.Save(Path.Combine(output, label + ".png"));
            pass("Real native chess buttons: " + label + " synchronized");
            bool Matches(TonariumClient client) => Revision(client) == previous + 1 &&
                client.State.Items[item!]?["board"] is JsonArray board && board[from] is null && board[to]?.ToString() == piece &&
                client.State.Items[item!]?["chess"]?["moves"] is JsonArray moves && moves.Count == moveCount && moves[^1]?.ToString() == notation;
        }
    }

    private static void ClickSquare(ItemWindow window, int square)
    {
        var grid = window.GetVisualDescendants().OfType<Grid>().Single(g => g.Children.Count == 64 && g.Children.All(c => c is Button));
        ((Button)grid.Children[square]).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    }
    private static void ClickReset(ItemWindow window) => window.GetVisualDescendants().OfType<Button>().Single(b => b.Content?.ToString() is "新しい対局" or "本当に初期化？").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static async Task Settle() { await Task.Delay(100); AvaloniaHeadlessPlatform.ForceRenderTimerTick(2); }
    private static async Task Until(Func<bool> condition, string label, Func<string?>? details = null)
    {
        var timer = Stopwatch.StartNew();
        while (!condition())
        {
            if (timer.Elapsed.TotalSeconds > 20) throw new TimeoutException(label + (details is null ? "" : ": " + details()));
            await Task.Delay(25);
        }
    }
}
