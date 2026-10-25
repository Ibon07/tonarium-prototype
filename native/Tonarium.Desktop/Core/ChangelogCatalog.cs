using System.Text.Json.Nodes;

namespace Tonarium.Desktop.Core;

public static class ChangelogCatalog
{
    public const string SeenKey = "tonarium.changelog.seen";
    public static readonly JsonArray Entries = Load();
    public static string Latest => J.Text(Entries.FirstOrDefault(), "date");
    public static bool Unread => string.CompareOrdinal(Latest, NativeSettings.GetString(SeenKey)) > 0;

    private static JsonArray Load()
    {
        using var stream = typeof(ChangelogCatalog).Assembly.GetManifestResourceStream("Tonarium.Changelog.json")!;
        return JsonNode.Parse(stream)!.AsArray();
    }
}
