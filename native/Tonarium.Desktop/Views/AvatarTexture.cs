using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using SkiaSharp;

namespace Tonarium.Desktop.Views;

internal sealed record AvatarSkin(AvatarTexture Texture, AvatarParameters Parameters, bool Custom)
{
    public AvatarBounds Bounds { get; } = AvatarModel.Shared.Value.Bounds(Parameters);
}

internal sealed class AvatarTexture
{
    public int Width { get; }
    public int Height { get; }
    public int[] Pixels { get; }
    public AvatarTexture(int width,int height,int[] pixels) { Width=width;Height=height;Pixels=pixels; }
    public static AvatarTexture Decode(byte[] bytes)
    {
        using var decoded = SKBitmap.Decode(bytes) ?? throw new IOException("Invalid avatar texture.");
        float scale = Math.Min(1f, 2048f / decoded.Width);
        int width = Math.Max(1,(int)(decoded.Width*scale)), height=Math.Max(1,(int)(decoded.Height*scale));
        using var image = new SKBitmap(new SKImageInfo(width,height,SKColorType.Bgra8888,SKAlphaType.Unpremul));
        using (var canvas = new SKCanvas(image)) canvas.DrawBitmap(decoded,new SKRect(0,0,width,height));
        var pixels = new int[width*height]; Marshal.Copy(image.GetPixels(),pixels,0,pixels.Length);
        return new AvatarTexture(width,height,pixels);
    }
}

internal static class AvatarSkins
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly Dictionary<string,Task<AvatarSkin>> Cache = new(StringComparer.Ordinal);
    private static readonly Dictionary<string,DateTime> CachedAt = new(StringComparer.Ordinal);
    private static readonly Queue<string> Order = new();
    public static readonly Lazy<AvatarSkin> Sample = new(() =>
    {
        using var stream = typeof(AvatarSkins).Assembly.GetManifestResourceStream("Tonarium.OekakiSample.png")
            ?? throw new IOException("Oekaki sample texture is missing.");
        using var data = new MemoryStream(); stream.CopyTo(data);
        return new AvatarSkin(AvatarTexture.Decode(data.ToArray()),new AvatarParameters(),false);
    });
    public static Task<AvatarSkin> Load(string server,string name,string version,bool refresh=false,bool discover=false)
    {
        if (string.IsNullOrEmpty(version)&&!discover) return Task.FromResult(Sample.Value);
        string key = server+"\n"+name+"\n"+(discover?"@stored":version);
        lock(Cache)
        {
            if (!refresh && Cache.TryGetValue(key,out var task) && (!discover || DateTime.UtcNow-CachedAt[key]<TimeSpan.FromSeconds(30))) return task;
            var loading = Fetch(server,name,version); Cache[key]=loading; CachedAt[key]=DateTime.UtcNow; Order.Enqueue(key);
            while(Order.Count>8) { string expired=Order.Dequeue(); if(expired!=key) { Cache.Remove(expired); CachedAt.Remove(expired); } }
            return loading;
        }
    }
    private static async Task<AvatarSkin> Fetch(string server,string name,string version)
    {
        string query = "?name="+Uri.EscapeDataString(name.Trim())+(string.IsNullOrEmpty(version)?"":"&v="+Uri.EscapeDataString(version));
        try
        {
            var textureTask = Http.GetByteArrayAsync(server.TrimEnd('/')+"/avatar"+query);
            var texture = AvatarTexture.Decode(await textureTask.ConfigureAwait(false));
            AvatarParameters parameters;
            try { parameters=ParseParameters(await Http.GetStringAsync(server.TrimEnd('/')+"/avatar/params"+query).ConfigureAwait(false)); }
            catch(Exception e) when(e is HttpRequestException or JsonException or TaskCanceledException) { parameters=new AvatarParameters(); }
            return new AvatarSkin(texture,parameters,true);
        }
        catch(Exception e) when(e is HttpRequestException or IOException or TaskCanceledException) { return Sample.Value; }
    }
    private static AvatarParameters ParseParameters(string json)
    {
        var root = JsonNode.Parse(json);
        float N(string key) => Math.Clamp(float.TryParse(root?[key]?.ToString(),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out float n) && float.IsFinite(n)?n:0,-100,100);
        bool B(string key,bool fallback=false) => bool.TryParse(root?[key]?.ToString(),out bool value)?value:fallback;
        return new AvatarParameters {
            HeadSize=N("headSize"),NeckLength=N("neckLength"),HeadInFront=B("headInFront",true),HandSize=N("handSize"),
            BodySize=N("bodySize"),TailSize=N("tailSize"),TailPosition=N("tailPosition"),TailRotation=N("tailRotation"),DisableTail=B("disableTail"),
            LegsSize=N("legsSize"),LegsDistance=N("legsDistance"),LegsDistanceFromBody=N("legsDistanceFromBody"),LegsInFront=B("legsInFront",true)
        };
    }
}
