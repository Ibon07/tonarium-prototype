using System.Text.Json.Nodes;
namespace Tonarium.Desktop.Core;
public static class EmoteCatalog
{
    public static readonly JsonObject All = Load();
    public readonly record struct Pose(float Y, float Rx, float Rz, float Sx, float Sy, float Left, float Right, float Bow, float LiftLeft, float LiftRight);
    // shared/emotes.ts, in model coordinates before the common 0.012 scale.
    public static Pose GetPose(string id, float elapsed)
    {
        var duration = (float)J.Number(All[id], "duration");
        float Smooth(float value) { value = Math.Clamp(value, 0, 1); return value * value * (3 - 2 * value); }
        var w = Smooth(elapsed / 220) * Smooth((duration - elapsed) / 350); var t = Math.Max(0, elapsed) / 1000;
        if (id == "wave") return new(0, 0, MathF.Sin(t * 6) * .06f * w, 1, 1, 0, (-.25f + MathF.Sin(t * 17) * .55f) * w, 0, 0, 38 * w);
        if (id == "hop") { var b = MathF.Abs(MathF.Sin(t * MathF.PI * 3)); return new(b * .38f * w, 0, 0, 1 + (.08f - b * .12f) * w, 1 + (b * .16f - .1f) * w, -.4f * w, .4f * w, 0, 28 * w, 28 * w); }
        if (id == "slump") return new(-.13f * w, -.2f * w, 0, 1, 1 - .16f * w, .22f * w, -.22f * w, .48f * w, -10 * w, -10 * w);
        if (id == "fall") { var c = Smooth((elapsed - 150) / 500) * Smooth((duration - elapsed) / 500); return new(.12f * c, 0, -MathF.PI / 2 * c, 1, 1, -.7f * c, .8f * c, 0, 0, 0); }
        return new(0, 0, 0, 1, 1, 0, 0, 0, 0, 0);
    }
    private static JsonObject Load()
    {
        using var stream = typeof(EmoteCatalog).Assembly.GetManifestResourceStream("Tonarium.WorldCatalog.json")!;
        return J.Object(JsonNode.Parse(stream), "emotes");
    }
}
