using System.Text.Json.Nodes;

namespace Tonarium.Desktop.Core;

public static class J
{
    public static string Text(JsonNode? node, string key, string fallback = "") => Value(node?[key], fallback);
    public static string Value(JsonNode? node, string fallback = "") => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : node?.ToString() ?? fallback;
    public static double Number(JsonNode? node, string key, double fallback = 0) => double.TryParse(node?[key]?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : fallback;
    public static bool Bool(JsonNode? node, string key, bool fallback = false) => bool.TryParse(node?[key]?.ToString(), out var b) ? b : fallback;
    public static JsonArray Array(JsonNode? node, string key) => node?[key] as JsonArray ?? new();
    public static JsonObject Object(JsonNode? node, string key) => node?[key] as JsonObject ?? new();
    public static string Label(string kind) => kind switch { "room" => "ホール", "cafe" => "カフェ", "game" => "板わたり", "public" => "パブリック", "friends" => "フレンド+", "groupPlus" => "グループ+", "group" => "グループ", "invite" => "インバイト", "joinMe" => "参加 OK", "online" => "オンライン", "askMe" => "声かけて", "busy" => "取り込み中", _ => kind };
}
