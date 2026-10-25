using System.Text.Json.Nodes;
using Tonarium.Desktop.Core;

internal static class EmoteProbe
{
    internal static async Task Run(Action<string> pass)
    {
        await using var client = new TonariumClient(persistSettings: false);
        var state = client.State;
        state.SessionId = "emote-check";
        state.Users = new JsonArray(
            new JsonObject { ["id"] = "peer", ["name"] = "emote-check-peer", ["session"] = state.SessionId },
            new JsonObject { ["id"] = "outside", ["name"] = "emote-check-outside", ["session"] = "elsewhere" });
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        JsonObject Message(string id, long at, string sid = "emote-check", string from = "peer") => new()
            { ["t"] = "emote", ["sid"] = sid, ["from"] = from, ["id"] = id, ["at"] = at };
        void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
        foreach (var (id, definition) in EmoteCatalog.All)
        {
            state.Emotes.Clear();
            client.ApplyMessage(Message(id, now));
            Require(state.Emotes["peer"]?["id"]?.ToString() == id, "Supported emote not accepted: " + id);
            var accepted = state.Emotes["peer"];
            client.ApplyMessage(Message(id, now));
            Require(ReferenceEquals(accepted, state.Emotes["peer"]), "Duplicate emote restarted animation");
            client.ApplyMessage(Message(id, now - 1));
            Require(ReferenceEquals(accepted, state.Emotes["peer"]), "Older emote replaced newer event");
            state.Emotes.Clear();
            client.ApplyMessage(Message(id, now - (long)J.Number(definition, "duration") - 100));
            Require(state.Emotes.Count == 0, "Expired emote accepted");
        }
        Require(EmoteCatalog.All.Count == 4, "Expected four shared emotes");
        pass("All shared emotes accepted once; duplicate, old and expired events cannot restart reactions");
        client.ApplyMessage(Message("invalid", now));
        client.ApplyMessage(Message("wave", now, "other-session"));
        client.ApplyMessage(Message("wave", now, from: "missing"));
        client.ApplyMessage(Message("wave", now, from: "outside"));
        Require(state.Emotes.Count == 0, "Invalid or nonparticipant emote accepted");
        pass("Emotes from other sessions, nonparticipants and unsupported IDs are ignored");
        bool alreadyBlocked = NativeSettings.BlockedNames.Contains("emote-check-peer");
        try
        {
            NativeSettings.BlockedNames.Add("emote-check-peer");
            client.ApplyMessage(Message("wave", now));
            Require(state.Emotes.Count == 0, "Blocked participant emote accepted");
        }
        finally { if (!alreadyBlocked) NativeSettings.BlockedNames.Remove("emote-check-peer"); }
        pass("Blocked participants cannot trigger emotes (no user settings saved)");
    }
}
