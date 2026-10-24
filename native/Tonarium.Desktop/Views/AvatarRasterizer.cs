using System.Numerics;

namespace Tonarium.Desktop.Views;

internal sealed class AvatarRasterizer
{
    internal readonly record struct Vertex(float X,float Y,float Depth,float InverseW,float UOverW,float VOverW);
    public int Width { get; }
    public int Height { get; }
    public int[] Pixels { get; }
    private readonly float[] depth;
    private readonly Matrix4x4[] matrices;
    public AvatarRasterizer(int width,int height)
    {
        Width=width;Height=height;Pixels=new int[width*height];depth=new float[width*height];
        matrices=new Matrix4x4[AvatarModel.Shared.Value.Nodes.Length];
    }
    public void Draw(AvatarSkin skin,float time,float pitch,int expression,bool small,bool fullBody,Tonarium.Desktop.Core.EmoteCatalog.Pose? emote=null)
    {
        Array.Clear(Pixels);Array.Fill(depth,float.PositiveInfinity);
        var model=AvatarModel.Shared.Value;
        model.Pose(time,skin.Parameters,pitch,matrices,emote);
        var camera=Matrix4x4.CreateLookAt(new Vector3(0,1.05f,small?1f:1.25f),new Vector3(0,small?1.02f:.95f,0),Vector3.UnitY);
        var projection=Matrix4x4.CreatePerspectiveFieldOfView(MathF.PI/6,Width/(float)Height,.01f,10);
        var viewProjection=Matrix4x4.CreateScale(.012f)*camera*projection;
        var bounds=skin.Bounds;
        float modelScale=Math.Min((Width-12f)/Math.Max(1,bounds.Max.X-bounds.Min.X),(Height-12f)/Math.Max(1,bounds.Max.Y-bounds.Min.Y));
        var center=(bounds.Min+bounds.Max)*.5f;
        Span<Vertex> projected=stackalloc Vertex[4];
        for(int node=0;node<model.Nodes.Length;node++)
        {
            if(model.Nodes[node].Mesh is not {} meshIndex)continue;
            var mesh=model.Meshes[meshIndex];
            var transform=matrices[node]*viewProjection;
            float faceOffset=model.Nodes[node].Name=="Head_Front"?(expression==1?1f/6:expression==2?-1f/6:0):0;
            for(int i=0;i<mesh.Positions.Length/3;i++)
            {
                var original=AvatarModel.Vector(mesh.Positions,i*3);
                if(fullBody)
                {
                    var p=Vector3.Transform(original,matrices[node]);
                    projected[i]=new Vertex((p.X-center.X)*modelScale+Width*.5f,(center.Y-p.Y)*modelScale+Height*.5f,-p.Z,1,mesh.TextureCoordinates[i*2]+faceOffset,mesh.TextureCoordinates[i*2+1]);
                }
                else
                {
                    var p=Vector4.Transform(new Vector4(original,1),transform);
                    float iw=1/p.W;
                    projected[i]=new Vertex((p.X*iw+1)*Width*.5f,(1-p.Y*iw)*Height*.5f,p.Z*iw,iw,(mesh.TextureCoordinates[i*2]+faceOffset)*iw,mesh.TextureCoordinates[i*2+1]*iw);
                }
            }
            bool mirrored=matrices[node].GetDeterminant()<0;
            for(int i=0;i<mesh.Indices.Length;i+=3) Triangle(projected[mesh.Indices[i]],projected[mesh.Indices[i+1]],projected[mesh.Indices[i+2]],skin.Texture,mirrored);
        }
    }
    private static float Edge(in Vertex a,in Vertex b,float x,float y)=>(b.X-a.X)*(y-a.Y)-(b.Y-a.Y)*(x-a.X);
    private void Triangle(Vertex a,Vertex b,Vertex c,AvatarTexture texture,bool mirrored)
    {
        float area=Edge(a,b,c.X,c.Y);
        if(mirrored?area<=.0001f:area>=-.0001f)return;
        int minX=Math.Clamp((int)MathF.Floor(MathF.Min(a.X,MathF.Min(b.X,c.X))),0,Width-1);
        int maxX=Math.Clamp((int)MathF.Ceiling(MathF.Max(a.X,MathF.Max(b.X,c.X))),0,Width-1);
        int minY=Math.Clamp((int)MathF.Floor(MathF.Min(a.Y,MathF.Min(b.Y,c.Y))),0,Height-1);
        int maxY=Math.Clamp((int)MathF.Ceiling(MathF.Max(a.Y,MathF.Max(b.Y,c.Y))),0,Height-1);
        float invArea=1/area;
        float waX=-(c.Y-b.Y)*invArea,wbX=-(a.Y-c.Y)*invArea;
        float waY=(c.X-b.X)*invArea,wbY=(a.X-c.X)*invArea;
        float waRow=Edge(b,c,minX+.5f,minY+.5f)*invArea,wbRow=Edge(c,a,minX+.5f,minY+.5f)*invArea;
        for(int y=minY;y<=maxY;y++,waRow+=waY,wbRow+=wbY)
        {
            float wa=waRow,wb=wbRow;
            for(int x=minX;x<=maxX;x++,wa+=waX,wb+=wbX)
            {
            float wc=1-wa-wb;
            if(wa<0||wb<0||wc<0)continue;
            int index=y*Width+x;float z=wa*a.Depth+wb*b.Depth+wc*c.Depth;
            if(z>=depth[index])continue;
            float inverse=wa*a.InverseW+wb*b.InverseW+wc*c.InverseW;
            if(inverse<=0)continue;
            float u=(wa*a.UOverW+wb*b.UOverW+wc*c.UOverW)/inverse,v=(wa*a.VOverW+wb*b.VOverW+wc*c.VOverW)/inverse;
            float tx=Math.Clamp(u*texture.Width-.5f,0,texture.Width-1),ty=Math.Clamp(v*texture.Height-.5f,0,texture.Height-1);
            int ix=(int)tx,iy=(int)ty,nx=Math.Min(ix+1,texture.Width-1),ny=Math.Min(iy+1,texture.Height-1);
            uint c00=(uint)texture.Pixels[iy*texture.Width+ix],c10=(uint)texture.Pixels[iy*texture.Width+nx];
            uint c01=(uint)texture.Pixels[ny*texture.Width+ix],c11=(uint)texture.Pixels[ny*texture.Width+nx];
            if(((c00|c10|c01|c11)&0xff000000u)==0)continue;
            float fx=tx-ix,fy=ty-iy;
            uint alpha=(uint)(((c00>>24)*(1-fx)+(c10>>24)*fx)*(1-fy)+((c01>>24)*(1-fx)+(c11>>24)*fx)*fy+.5f);
            if(alpha<128)continue;
            uint pixel=alpha<<24;
            for(int component=0;component<24;component+=8)
            {
                float top=((c00>>component)&255)*(1-fx)+((c10>>component)&255)*fx;
                float bottom=((c01>>component)&255)*(1-fx)+((c11>>component)&255)*fx;
                pixel|=(uint)(top*(1-fy)+bottom*fy+.5f)<<component;
            }
            if(alpha<255)
            {
                uint blue=(pixel&255)*alpha/255,green=((pixel>>8)&255)*alpha/255,red=((pixel>>16)&255)*alpha/255;
                pixel=(alpha<<24)|(red<<16)|(green<<8)|blue;
            }
            Pixels[index]=unchecked((int)pixel);depth[index]=z;
            }
        }
    }
    public ulong Checksum()
    {
        ulong hash=1469598103934665603;
        for(int i=0;i<Pixels.Length;i++)hash=unchecked((hash^(uint)Pixels[i])*1099511628211);
        return hash;
    }
}
