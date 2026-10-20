using System.Text.Json.Nodes;

namespace Tonarium.Desktop.Core;

/// <summary>Local UI preferences, independent of the user's server profile.</summary>
public static class NativeSettings
{
    private static readonly object Gate = new();
    private static readonly string FilePath = Path.Combine(DesktopInstance.DataDirectory, "preferences.json");
    private static readonly JsonObject Values;
    public static HashSet<string> BlockedNames { get; } = new(StringComparer.Ordinal);

    static NativeSettings()
    {
        try { Values = JsonNode.Parse(File.ReadAllText(FilePath)) as JsonObject ?? new(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { Values = new(); }
        if (Values["blockedNames"] is JsonArray blocked)
            foreach (var name in blocked) if (name?.GetValue<string>() is { Length: > 0 } text) BlockedNames.Add(text);
    }

    public static string GetString(string name, string fallback = "")
    {
        lock (Gate) return Values[name] is JsonValue v && v.TryGetValue<string>(out var value) ? value : fallback;
    }
    public static bool GetBool(string name, bool fallback = false)
    {
        lock (Gate) return Values[name] is JsonValue v && v.TryGetValue<bool>(out var value) ? value : fallback;
    }
    public static void SetString(string name, string value) { lock (Gate) { Values[name] = value; Save(); } }
    public static void SetBool(string name, bool value) { lock (Gate) { Values[name] = value; Save(); } }
    public static void SetBlocked(string name, bool blocked)
    {
        lock (Gate) { if (blocked) BlockedNames.Add(name); else BlockedNames.Remove(name); Save(); }
    }
    public static void Save()
    {
        lock (Gate)
        {
            Values["blockedNames"] = new JsonArray(BlockedNames.OrderBy(x => x).Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
                var temporary = FilePath + ".tmp";
                File.WriteAllText(temporary, Values.ToJsonString(new() { WriteIndented = true }));
                File.Move(temporary, FilePath, true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { System.Diagnostics.Debug.WriteLine(ex); }
        }
    }
}
