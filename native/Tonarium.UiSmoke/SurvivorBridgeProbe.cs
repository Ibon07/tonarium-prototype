using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json.Nodes;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.ThreeD;

internal static class SurvivorBridgeProbe
{
    internal static async Task Run(Action<string> pass)
    {
        await using var client = new TonariumClient(persistSettings: false);
        await using var host = new ThreeDHost(client);
        var state = client.State;
        state.SessionId = "survivor-bridge";
        state.World = "survivors";
        state.Survivor = new JsonObject
        {
            ["run"] = 3, ["phase"] = "lobby",
            ["stylePicks"] = new JsonObject { [state.SelfId] = "stargazer" }
        };
        state.SurvivorProfile = new JsonObject { ["points"] = 8 };
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        using var lifetime = new CancellationTokenSource();
        Set(host, "listener", listener); Set(host, "lifetime", lifetime); Set(host, "sessionId", state.SessionId);
        var receive = (Task)typeof(ThreeDHost).GetMethod("ReceiveAsync", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(host, [lifetime.Token])!;
        Set(host, "receiveTask", receive);
        using var unity = new TcpClient();
        await unity.ConnectAsync((IPEndPoint)listener.LocalEndpoint);
        using var writer = new StreamWriter(unity.GetStream()) { AutoFlush = true };
        using var reader = new StreamReader(unity.GetStream());
        try
        {
            await writer.WriteLineAsync("{\"t\":\"ready\"}");
            var initial = await Read("snapshot");
            Require(JsonNode.DeepEquals(initial["survivor"], state.Survivor) && JsonNode.DeepEquals(initial["survivorProfile"], state.SurvivorProfile), "initial bridge snapshot omitted survivor state/profile");
            pass("Unity bridge ready snapshot includes run, style picks and private profile");

            foreach (var phase in new[] { "lobby", "ended" })
            {
                state.Survivor["phase"] = phase;
                state.Survivor["bossDefeated"] = phase == "ended";
                var saved = state.Survivor.DeepClone();
                // 別セッションの切替を混ぜ、次の実メッセージで転送されないことも確かめる。
                client.ApplyMessage(new JsonObject { ["t"] = "world", ["sid"] = "other-session", ["world"] = "game" });
                client.ApplyMessage(new JsonObject { ["t"] = "world", ["sid"] = state.SessionId, ["world"] = "room" });
                Require((await Read("world"))["world"]?.ToString() == "room", "foreign world crossed the bridge");
                client.ApplyMessage(new JsonObject { ["t"] = "world", ["sid"] = state.SessionId, ["world"] = "survivors" });
                Require((await Read("world"))["world"]?.ToString() == "survivors", "missing survivor world transition");
                var restored = await Read("survivor");
                Require(restored["sid"]?.ToString() == state.SessionId && JsonNode.DeepEquals(restored["state"], saved), "world reentry lost held survivor state");
            }
            pass("World reentry forwards held lobby/style and ended/result states after the world message, excluding other sessions");

            client.ApplyMessage(new JsonObject { ["t"] = "survivorProfile", ["profile"] = new JsonObject { ["points"] = 12 } });
            Require((await Read("survivorProfile"))["profile"]?["points"]?.GetValue<int>() == 12, "profile update did not reach Unity");
            client.ApplySessionSnapshot(new JsonObject
            {
                ["sid"] = state.SessionId, ["world"] = "survivors", ["now"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                ["survivor"] = state.Survivor.DeepClone()
            });
            var rejoined = await Read("snapshot");
            Require(JsonNode.DeepEquals(rejoined["survivor"], state.Survivor) && rejoined["survivorProfile"]?["points"]?.GetValue<int>() == 12, "session snapshot omitted current profile/run");
            pass("Profile updates and rejoin snapshots preserve the latest private profile and run in the Unity bridge");
        }
        finally { await host.StopAsync(); }

        async Task<JsonObject> Read(string type)
        {
            var line = await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
            var message = JsonNode.Parse(line ?? throw new IOException("Unity bridge closed"))!.AsObject();
            Require(message["t"]?.ToString() == type, $"Expected {type}, received {message["t"]}");
            return message;
        }
    }
    private static void Set(object instance, string name, object? value) => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);
    private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
}
