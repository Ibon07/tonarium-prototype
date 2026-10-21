using System.Diagnostics;
using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using Avalonia.VisualTree;
using SkiaSharp;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;

namespace Tonarium.Desktop.Views;

public sealed class AvatarPortrait : Control
{
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly List<WeakReference<AvatarPortrait>> VisiblePortraits = [];
    private static readonly DispatcherTimer AnimationTimer = new() { Interval = TimeSpan.FromMilliseconds(66) };
    private readonly NativeContext context;
    private readonly string identity;
    private bool small;
    private readonly float phase;
    private AvatarSkin? skin;
    private AvatarRasterizer? raster;
    private WriteableBitmap? bitmap;
    private string skinKey = "";
    private bool attached, rendering;
    private long skinRequest;
    private float lastRendered, smoothPitch;
    public bool FullBody { get; set; }
    public bool Small { get => small; set { if (small == value) return; small = value; Advance(true); } }
    public float? LookPitch { get; set; }
    public bool? Speaking { get; set; }
    public long FrameCount { get; private set; }
    public ulong LastFrameChecksum => raster?.Checksum()??0;
    public double LastRenderMilliseconds { get; private set; }
    public bool IsTextureReady { get; private set; }
    public bool IsCustomTexture => skin?.Custom == true;
    public string TextureKey => skinKey;
    public int TriangleCount => AvatarModel.Shared.Value.Meshes.Sum(x => x.Indices.Length / 3);
    public int AnimationChannelCount => AvatarModel.Shared.Value.Channels.Length;

    static AvatarPortrait() => AnimationTimer.Tick += (_, _) =>
    {
        for (int i = VisiblePortraits.Count - 1; i >= 0; i--)
        {
            if (!VisiblePortraits[i].TryGetTarget(out var portrait) || !portrait.attached) { VisiblePortraits.RemoveAt(i); continue; }
            portrait.Advance();
        }
        if (VisiblePortraits.Count == 0) AnimationTimer.Stop();
    };

    public AvatarPortrait(NativeContext context,string id,bool small=false)
    {
        this.context=context; identity=id; this.small=small;
        uint hash=2166136261;foreach(char c in id)hash=unchecked((hash^c)*16777619);
        phase=hash%10000/1000f;
        ClipToBounds=true;IsHitTestVisible=false;
        RenderOptions.SetBitmapInterpolationMode(this,BitmapInterpolationMode.HighQuality);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);attached=true;
        VisiblePortraits.Add(new WeakReference<AvatarPortrait>(this));AnimationTimer.Start();Advance(true);
    }
    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        attached=false;bitmap?.Dispose();bitmap=null;raster=null;
        skinRequest++;skin=null;skinKey="";IsTextureReady=false;
        VisiblePortraits.RemoveAll(reference => !reference.TryGetTarget(out var portrait) || ReferenceEquals(portrait,this));
        if(VisiblePortraits.Count==0)AnimationTimer.Stop();
        base.OnDetachedFromVisualTree(e);
    }
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        // Attachment can precede layout. Render the first frame as soon as its size is known.
        if(change.Property==BoundsProperty && change.GetOldValue<Rect>().Size!=Bounds.Size)Advance(true);
    }
    public override void Render(DrawingContext drawing)
    {
        base.Render(drawing);
        // A clipping ancestor may still have zero bounds during the child's first layout.
        // By render time the entire tree is arranged, so never present an empty first frame.
        rendering=true;
        try
        {
            if(bitmap is null)Advance(true);
            if(bitmap is not null)drawing.DrawImage(bitmap,new Rect(bitmap.Size),new Rect(Bounds.Size));
        }
        finally { rendering=false; }
    }
    public void RefreshAvatar()
    {
        skinKey="";IsTextureReady=false;if(attached) { UpdateSkin(true);Advance(true); }
    }
    private bool InViewport()
    {
        if(!attached||!IsEffectivelyVisible||Bounds.Width<1||Bounds.Height<1||TopLevel.GetTopLevel(this) is Window { WindowState:WindowState.Minimized })return false;
        foreach(var ancestor in this.GetVisualAncestors().OfType<Control>())
        {
            if(!ancestor.IsVisible)return false;
            if(!ancestor.ClipToBounds)continue;
            var origin=this.TranslatePoint(default,ancestor);
            if(origin is {} p&&!new Rect(ancestor.Bounds.Size).Intersects(new Rect(p,Bounds.Size)))return false;
        }
        return true;
    }
    private void Advance(bool force=false)
    {
        if(!InViewport())return;
        float time=(float)Clock.Elapsed.TotalSeconds;
        if(!force&&time-lastRendered<(small?.12f:.063f))return;
        lastRendered=time;
        UpdateSkin();skin??=AvatarSkins.Sample.Value;
        double scaling=TopLevel.GetTopLevel(this)?.RenderScaling??1;
        double factor=Math.Min(Math.Max(1.5,scaling),(small?192d:768d)/Math.Max(Bounds.Width,Bounds.Height));
        int width=Math.Clamp((int)Math.Ceiling(Bounds.Width*factor),1,768),height=Math.Clamp((int)Math.Ceiling(Bounds.Height*factor),1,768);
        if(raster is null||raster.Width!=width||raster.Height!=height)
        {
            bitmap?.Dispose();raster=new AvatarRasterizer(width,height);
            bitmap=new WriteableBitmap(new PixelSize(width,height),new Vector(96,96),PixelFormat.Bgra8888,AlphaFormat.Premul);
        }
        float targetPitch=LookPitch??(float)J.Number(context.State.Avatars[identity],"pitch");
        smoothPitch+=(targetPitch-smoothPitch)*.55f;
        bool speaking=Speaking??(context.Media is NativeMedia native&&native.IsSpeaking(identity));
        float animationTime=time+phase;
        int expression=speaking&&MathF.Sin(time/.09f)>0?2:animationTime%4.1f<.16f?1:0;
        long started=Stopwatch.GetTimestamp();
        raster.Draw(skin,animationTime,smoothPitch,expression,small,FullBody);
        LastRenderMilliseconds=Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        using(var target=bitmap!.Lock())
        {
            if(target.RowBytes==width*4)Marshal.Copy(raster.Pixels,0,target.Address,raster.Pixels.Length);
            else for(int row=0;row<height;row++)Marshal.Copy(raster.Pixels,row*width,IntPtr.Add(target.Address,row*target.RowBytes),width);
        }
        FrameCount++;if(!rendering)InvalidateVisual();
    }
    private async void UpdateSkin(bool refresh=false)
    {
        var user=context.State.Users.FirstOrDefault(u=>J.Text(u,"id")==identity||J.Text(u,"name")==identity);
        string name=J.Text(user,"name",identity==context.State.SelfId?context.State.Name:identity);
        string version=J.Text(user,"avatar");
        bool discover=user is null&&!string.IsNullOrWhiteSpace(name);
        string key=context.State.ServerUrl+"\n"+name+"\n"+(discover?"@stored":version);
        if(!refresh&&skinKey==key)return;
        skinKey=key;IsTextureReady=false;
        var request=++skinRequest;
        try
        {
            var loaded=await AvatarSkins.Load(context.State.ServerUrl,name,version,refresh,discover);
            if(!attached||skinKey!=key||skinRequest!=request)return;
            skin=loaded;IsTextureReady=true;Advance(true);
        }
        catch(Exception error) { Program.Log("Avatar portrait: "+error.Message); }
    }

    public static void ExportVerification(string directory)
    {
        Directory.CreateDirectory(directory);
        var skin=AvatarSkins.Sample.Value;
        foreach(var state in new[] { ("normal",0f,0f,0,false),("idle-later",1.5f,0f,0,false),("blink",0f,0f,1,false),("speaking",0f,0f,2,false),("look-up",0f,.6f,0,false),("full-body",0f,0f,0,true) })
        {
            var renderer=new AvatarRasterizer(420,315);
            renderer.Draw(skin,state.Item2,state.Item3,state.Item4,false,state.Item5);
            using var image=new SKBitmap(new SKImageInfo(420,315,SKColorType.Bgra8888,SKAlphaType.Premul));
            Marshal.Copy(renderer.Pixels,0,image.GetPixels(),renderer.Pixels.Length);
            using var encoded=image.Encode(SKEncodedImageFormat.Png,100);
            using var file=File.Create(Path.Combine(directory,state.Item1+".png"));encoded.SaveTo(file);
        }
    }
}
