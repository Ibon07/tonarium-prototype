using System.Numerics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Tonarium.Desktop.Views;

internal sealed class AvatarModel
{
    internal sealed class Node
    {
        public string Name { get; set; } = "";
        public int? Mesh { get; set; }
        public int[] Children { get; set; } = [];
        public float[] Translation { get; set; } = [0, 0, 0];
        public float[] Rotation { get; set; } = [0, 0, 0, 1];
        public float[] Scale { get; set; } = [1, 1, 1];
    }
    internal sealed class Mesh
    {
        [JsonPropertyName("POSITION")] public float[] Positions { get; set; } = [];
        [JsonPropertyName("TEXCOORD_0")] public float[] TextureCoordinates { get; set; } = [];
        public int[] Indices { get; set; } = [];
    }
    internal sealed class Animation
    {
        public Channel[] Channels { get; set; } = [];
    }
    internal sealed class Channel
    {
        public int Node { get; set; }
        public string Path { get; set; } = "";
        public float[] Times { get; set; } = [];
        public float[] Values { get; set; } = [];
    }
    private sealed class Document
    {
        public Node[] Nodes { get; set; } = [];
        public Mesh[] Meshes { get; set; } = [];
        public Animation[] Animations { get; set; } = [];
    }
    public static readonly Lazy<AvatarModel> Shared = new(Load);
    public Node[] Nodes { get; }
    public Mesh[] Meshes { get; }
    public int[] Parents { get; }
    public Channel[] Channels { get; }
    private readonly Dictionary<string, int> indices;

    private AvatarModel(Document document)
    {
        Nodes = document.Nodes; Meshes = document.Meshes;
        Channels = document.Animations.SelectMany(x => x.Channels).ToArray();
        Parents = Enumerable.Repeat(-1, Nodes.Length).ToArray();
        indices = new Dictionary<string, int>();
        for (int i = 0; i < Nodes.Length; i++)
        {
            indices[Nodes[i].Name] = i;
            foreach (int child in Nodes[i].Children) Parents[child] = i;
        }
    }

    private static AvatarModel Load()
    {
        using var stream = typeof(AvatarModel).Assembly.GetManifestResourceStream("Tonarium.OekakiGeometry.json")
            ?? throw new IOException("Oekaki avatar geometry resource is missing.");
        var document = JsonSerializer.Deserialize<Document>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new IOException("Oekaki avatar geometry is invalid.");
        return new AvatarModel(document);
    }

    public void Pose(float seconds, AvatarParameters parameters, float pitch, Span<Matrix4x4> world, Tonarium.Desktop.Core.EmoteCatalog.Pose? emote = null)
    {
        Span<Vector3> translations = stackalloc Vector3[Nodes.Length];
        Span<Vector3> scales = stackalloc Vector3[Nodes.Length];
        Span<Quaternion> rotations = stackalloc Quaternion[Nodes.Length];
        for (int i = 0; i < Nodes.Length; i++)
        {
            translations[i] = Vector(Nodes[i].Translation);
            scales[i] = Vector(Nodes[i].Scale);
            rotations[i] = Rotation(Nodes[i].Rotation, 0);
        }
        foreach (var channel in Channels)
        {
            if (channel.Times.Length == 0) continue;
            float duration = channel.Times[^1];
            float time = duration > 0 ? seconds % duration : 0;
            int frame = Array.BinarySearch(channel.Times, time);
            if (frame < 0) frame = Math.Max(0, ~frame - 1);
            int next = Math.Min(frame + 1, channel.Times.Length - 1);
            float step = channel.Times[next] - channel.Times[frame];
            float alpha = step > 0 ? (time - channel.Times[frame]) / step : 0;
            if (channel.Path == "rotation") rotations[channel.Node] = Quaternion.Slerp(Rotation(channel.Values, frame * 4), Rotation(channel.Values, next * 4), alpha);
            else if (channel.Path == "translation") translations[channel.Node] = Vector3.Lerp(Vector(channel.Values, frame * 3), Vector(channel.Values, next * 3), alpha);
            else if (channel.Path == "scale") scales[channel.Node] = Vector3.Lerp(Vector(channel.Values, frame * 3), Vector(channel.Values, next * 3), alpha);
        }
        AddScale(scales,"Head_Front", parameters.HeadSize); AddScale(scales,"Head_Back", parameters.HeadSize);
        AddScale(scales,"Body_Front", parameters.BodySize); AddScale(scales,"Body_Back", parameters.BodySize);
        AddScale(scales,"LeftHand", parameters.HandSize); AddScale(scales,"RightHand", parameters.HandSize);
        AddScale(scales,"Tail", parameters.TailSize); AddScale(scales,"Feet", parameters.LegsSize);
        AddTranslation(translations,"Body", new Vector3(0, -parameters.NeckLength, parameters.HeadInFront ? -.5f : .5f));
        AddTranslation(translations,"Tail", new Vector3(0, -parameters.TailPosition, 0));
        AddTranslation(translations,"Feet", new Vector3(0, -parameters.LegsDistanceFromBody, parameters.LegsInFront ? .5f : -.5f));
        AddTranslation(translations,"LeftFoot", new Vector3(parameters.LegsDistance, 0, 0));
        AddTranslation(translations,"RightFoot", new Vector3(-parameters.LegsDistance, 0, .001f));
        int tail = indices["Tail"];
        rotations[tail] = Quaternion.Normalize(rotations[tail] * Quaternion.CreateFromAxisAngle(Vector3.UnitZ, parameters.TailRotation));
        var tilt = Quaternion.CreateFromAxisAngle(Vector3.UnitX, -Math.Clamp(pitch * .8f, -.7f, .7f));
        foreach (string name in new[] { "Head_Front", "Head_Back" })
        {
            int i = indices[name]; rotations[i] = Quaternion.Normalize(tilt * rotations[i]);
        }
        if (emote is { } reaction)
        {
            AddTranslation(translations, "LeftHand", new Vector3(0, reaction.LiftLeft, 0)); AddTranslation(translations, "RightHand", new Vector3(0, reaction.LiftRight, 0));
            rotations[indices["LeftHand"]] *= Quaternion.CreateFromAxisAngle(Vector3.UnitZ, reaction.Left);
            rotations[indices["RightHand"]] *= Quaternion.CreateFromAxisAngle(Vector3.UnitZ, reaction.Right);
            foreach (string name in new[] { "Head_Front", "Head_Back" }) rotations[indices[name]] = Quaternion.CreateFromAxisAngle(Vector3.UnitX, reaction.Bow) * rotations[indices[name]];
        }
        for (int i = 0; i < Nodes.Length; i++)
        {
            if (parameters.DisableTail && (Nodes[i].Name == "Tail" || Nodes[i].Name.StartsWith("Tail_"))) scales[i] = Vector3.Zero;
            world[i] = Matrix4x4.CreateScale(scales[i]) * Matrix4x4.CreateFromQuaternion(rotations[i]) * Matrix4x4.CreateTranslation(translations[i]);
            if (Parents[i] >= 0) world[i] *= world[Parents[i]];
            else if (emote is { } pose) world[i] *= Matrix4x4.CreateScale(pose.Sx, pose.Sy, 1) * Matrix4x4.CreateRotationX(pose.Rx) * Matrix4x4.CreateRotationZ(pose.Rz) * Matrix4x4.CreateTranslation(0, pose.Y / .012f, 0);
        }
    }
    private void AddScale(Span<Vector3> scales, string name, float delta) => scales[indices[name]] += new Vector3(delta);
    private void AddTranslation(Span<Vector3> translations, string name, Vector3 delta) => translations[indices[name]] += delta;

    public AvatarBounds Bounds(AvatarParameters parameters)
    {
        var min = new Vector2(float.PositiveInfinity);
        var max = new Vector2(float.NegativeInfinity);
        var matrices = new Matrix4x4[Nodes.Length];
        for (int frame = 0; frame < 8; frame++)
        {
            Pose(frame * .5f, parameters, 0, matrices);
            for (int i = 0; i < Nodes.Length; i++)
            {
                if (Nodes[i].Mesh is not { } index) continue;
                var mesh = Meshes[index];
                for (int j = 0; j < mesh.Positions.Length; j += 3)
                {
                    var p = Vector3.Transform(Vector(mesh.Positions, j), matrices[i]);
                    min = Vector2.Min(min, new Vector2(p.X, p.Y)); max = Vector2.Max(max, new Vector2(p.X, p.Y));
                }
            }
        }
        return new AvatarBounds(min, max);
    }
    internal static Vector3 Vector(float[] values, int offset = 0) => new(values[offset], values[offset + 1], values[offset + 2]);
    private static Quaternion Rotation(float[] values, int offset) => new(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]);
}

internal readonly record struct AvatarBounds(Vector2 Min, Vector2 Max);
internal sealed record AvatarParameters
{
    public float HeadSize { get; init; }
    public float NeckLength { get; init; }
    public bool HeadInFront { get; init; } = true;
    public float HandSize { get; init; }
    public float BodySize { get; init; }
    public float TailSize { get; init; }
    public float TailPosition { get; init; }
    public float TailRotation { get; init; }
    public bool DisableTail { get; init; }
    public float LegsSize { get; init; }
    public float LegsDistance { get; init; }
    public float LegsDistanceFromBody { get; init; }
    public bool LegsInFront { get; init; } = true;
}
