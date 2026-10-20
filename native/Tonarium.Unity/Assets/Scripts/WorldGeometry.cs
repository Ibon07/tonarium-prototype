using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        public void BuildWorld(string kind)
        {
            if (world == kind) return;
            world = kind; notice = "";
            if (environment != null) Destroy(environment);
            environment = new GameObject("World " + kind); tiles.Clear(); brokenTiles.Clear();
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.skybox = null;
            RenderSettings.ambientLight = ColorValue(kind == "cafe" ? "#aaa292" : "#aab3c5");
            RenderSettings.fog = true; RenderSettings.fogMode = FogMode.Linear; RenderSettings.fogStartDistance = 36; RenderSettings.fogEndDistance = 100;
            RenderSettings.fogColor = eye.backgroundColor = ColorValue(kind == "game" ? "#7fb6e6" : "#2b2d31");
            var light = new GameObject("Sun").AddComponent<Light>(); light.transform.SetParent(environment.transform); light.type = LightType.Directional; light.intensity = .9f; light.transform.rotation = Quaternion.Euler(45,-30,0); light.shadows = LightShadows.Soft;
            Box(environment.transform, "Floor", new Vector3(0,-.1f,0), new Vector3(20,.2f,20), kind == "cafe" ? "#8a5a3b" : kind == "game" ? "#3b3f6b" : "#565961");
            string wall = kind == "cafe" ? "#eadcc4" : kind == "game" ? "#465278" : "#80848e";
            Box(environment.transform,"South",new Vector3(0,2,10),new Vector3(20,4,.2f),wall);
            Box(environment.transform,"West",new Vector3(-10,2,0),new Vector3(.2f,4,20),wall);
            Box(environment.transform,"East",new Vector3(10,2,0),new Vector3(.2f,4,20),wall);
            var north = Box(environment.transform,"North",new Vector3(0,2,-10),new Vector3(20,4,.2f),wall);
            if (kind == "game")
            {
                var material = north.GetComponent<Renderer>().material;
                material.SetFloat("_Mode", 3); material.color = new Color(.7f,.88f,1,.12f);
                material.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                material.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                material.SetInt("_ZWrite", 0); material.EnableKeyword("_ALPHABLEND_ON"); material.renderQueue = 3000;
            }
            var spawn = Cylinder(environment.transform,"Spawn",new Vector3(0,.008f,6.5f),1.6f,.012f,kind == "cafe" ? "#deb877" : "#7ba3d3"); Destroy(spawn.GetComponent<Collider>());
            Label(environment.transform,"T O N A R I U M",new Vector3(0,2.65f,-9.86f),.13f).color = ColorValue(kind == "cafe" ? "#674d36" : "#e8eef8");
            if (kind == "cafe") BuildCafe();
            else if (kind == "game") BuildGame();
            else for (int i=-9;i<=9;i++)
            {
                var a=Box(environment.transform,"Grid",new Vector3(i,.006f,0),new Vector3(.012f,.003f,20),"#666a72"); Destroy(a.GetComponent<Collider>());
                var b=Box(environment.transform,"Grid",new Vector3(0,.006f,i),new Vector3(20,.003f,.012f),"#666a72"); Destroy(b.GetComponent<Collider>());
            }
        }

        public void SetPreviewCamera(string kind)
        {
            controller.enabled = false;
            controller.transform.position = ToUnity(kind == "game" ? new Vector3(0,6,5) : new Vector3(6,2.5f,8));
            eye.transform.LookAt(ToUnity(kind == "game" ? new Vector3(0,10,-20) : new Vector3(-2,1,-1)));
            controller.enabled = true;
        }

        void BuildCafe()
        {
            var r=environment.transform;
            for(int row=0;row<32;row++) for(int col=0;col<5;col++)
            {
                var plank=Box(r,"Plank",new Vector3(-8+col*4,.003f,-9.68f+row*.625f),new Vector3(3.98f,.004f,.607f),row%3==0?"#805537":"#916240"); Destroy(plank.GetComponent<Collider>());
            }
            Box(r,"Counter",new Vector3(-8.3f,.5f,-1),new Vector3(1.1f,1,8),"#5a3826");
            Box(r,"Countertop",new Vector3(-8.25f,1.04f,-1),new Vector3(1.3f,.08f,8.1f),"#d8c3a0");
            Box(r,"Coffee machine",new Vector3(-8.45f,1.3f,-3.4f),new Vector3(.55f,.5f,.7f),"#b9bcc0");
            Box(r,"Shelf",new Vector3(-9.6f,1.1f,-1),new Vector3(.5f,2.2f,8),"#6b4630");
            for(int y=0;y<3;y++) for(int j=0;j<9;j++) Cylinder(r,"Jar",new Vector3(-9.25f,.94f+y*.6f,-4.3f+j*.85f),.09f,.22f,j%2==0?"#c7843f":"#e0c08a");
            for(int i=0;i<5;i++) { Cylinder(r,"Stool leg",new Vector3(-7.25f,.38f,-4.2f+i*1.6f),.04f,.76f,"#303030"); Cylinder(r,"Stool seat",new Vector3(-7.25f,.78f,-4.2f+i*1.6f),.22f,.07f,"#7b3f2a"); }
            Vector2[] tables={new Vector2(3.2f,-3.5f),new Vector2(6.8f,-3.5f),new Vector2(3.2f,.5f),new Vector2(6.8f,.5f),new Vector2(-3.8f,4.2f)};
            foreach(var p in tables)
            {
                Cylinder(r,"Table",new Vector3(p.x,.74f,p.y),.5f,.05f,"#c49a6c"); Cylinder(r,"Table leg",new Vector3(p.x,.37f,p.y),.04f,.72f,"#303030");
                Cylinder(r,"Cup",new Vector3(p.x+.12f,.82f,p.y+.05f),.045f,.1f,"#fff4e0");
                Chair(r,p.x+.85f,p.y,90); Chair(r,p.x-.85f,p.y,-90); Pendant(r,p.x,p.y);
            }
            Box(r,"Sofa",new Vector3(9.25f,.25f,5),new Vector3(.9f,.5f,3.6f),"#6e3b33");
            Box(r,"Sofa back",new Vector3(9.58f,.7f,5),new Vector3(.24f,.65f,3.6f),"#6e3b33");
            for(int i=-1;i<=1;i++)Box(r,"Cushion",new Vector3(9.17f,.55f,5+i*1.2f),new Vector3(.7f,.14f,1.12f),"#8a4a40");
            Box(r,"Low table",new Vector3(7.9f,.4f,5),new Vector3(.8f,.05f,1.8f),"#c49a6c");
            Box(r,"Low table base",new Vector3(7.9f,.2f,5),new Vector3(.6f,.4f,1.6f),"#5a3826"); Pendant(r,8.3f,5);
            foreach(var p in new[]{new Vector2(8.9f,-8.9f),new Vector2(-8.9f,8.9f),new Vector2(8.9f,8.9f),new Vector2(-3.2f,-8.9f)})
            { Cylinder(r,"Pot",new Vector3(p.x,.25f,p.y),.3f,.5f,"#c46a43"); Sphere(r,"Plant",new Vector3(p.x,.95f,p.y),new Vector3(.85f,1.2f,.85f),"#4f7d45"); }
            for(int z=-6;z<=6;z+=4) Box(r,"Beam",new Vector3(0,3.88f,z),new Vector3(20,.24f,.3f),"#5a3826");
            Box(r,"Menu",new Vector3(-9.85f,3,-1),new Vector3(.06f,1.62f,2.6f),"#2c3a33");
            var menuText=Label(r,"Café Tonarium\n\nブレンドコーヒー　¥450\nカフェラテ　¥520\n抹茶ラテ　¥550\nチーズケーキ　¥480",new Vector3(-9.79f,3,-1),.048f); menuText.transform.rotation=Quaternion.Euler(0,270,0);
        }
        void Chair(Transform root,float x,float z,float rotation)
        {
            var c=new GameObject("Chair");c.transform.SetParent(root); c.transform.localPosition=ToUnity(new Vector3(x,0,z));c.transform.localRotation=Quaternion.Euler(0,-rotation,0);
            Box(c.transform,"Seat",new Vector3(0,.45f,0),new Vector3(.44f,.05f,.42f),"#9a6a45");Box(c.transform,"Back",new Vector3(0,.78f,.19f),new Vector3(.44f,.5f,.05f),"#9a6a45");
            for(int a=-1;a<=1;a+=2)for(int b=-1;b<=1;b+=2)Box(c.transform,"Leg",new Vector3(a*.18f,.22f,b*.17f),new Vector3(.04f,.44f,.04f),"#5a3826");
        }
        void Pendant(Transform root,float x,float z)
        {
            Cylinder(root,"Cord",new Vector3(x,3.35f,z),.008f,1.3f,"#222222");Cylinder(root,"Shade",new Vector3(x,2.65f,z),.26f,.2f,"#332e29");
            var l=new GameObject("Warm light").AddComponent<Light>();l.transform.SetParent(root);l.transform.localPosition=ToUnity(new Vector3(x,2.4f,z));l.type=LightType.Point;l.range=6;l.intensity=1.2f;l.color=ColorValue("#ffcf8a");
        }
        void BuildGame()
        {
            var r=environment.transform;
            for(int i=0;i<320;i++)
            {
                var t=Box(r,"Tile "+i,TilePosition(i)-Vector3.up*.125f,new Vector3(1.48f,.25f,1.48f),new[]{"#ecbfa5","#e5ce88","#90c7b4","#8db5d6","#b29aca"}[i/64]);
                t.AddComponent<GameTile>().Index=i;tiles[i]=t;
            }
            var start=Cylinder(r,"Start game",new Vector3(8.6f,.6f,-6.5f),.45f,1.2f,"#e9a75e");start.AddComponent<GameStart>();
            Label(r,"ゲーム開始\n参加エリアに集まろう",new Vector3(6.5f,1.9f,-8),.06f);
            Cylinder(r,"Join area",new Vector3(5.5f,.015f,-6.5f),1.8f,.02f,"#75c2d4");
            for(int x=-1;x<=1;x+=2)for(int z=-1;z<=1;z+=2)Box(r,"Tower",new Vector3(x*6.2f,10,-20+z*6.2f),new Vector3(.2f,22,.2f),"#596782");
        }
        static Vector3 TilePosition(int i)=>new Vector3(-6+(i%8+.5f)*1.5f,new[]{20,15,10,5,0}[i/64],-26+((i%64)/8+.5f)*1.5f);
        static Color ColorValue(string html){ColorUtility.TryParseHtmlString(html??"#ffffff",out var c);return c;}
        static Material Material(string color){var m=new Material(Shader.Find("Standard"));m.color=ColorValue(color);m.SetFloat("_Glossiness",.15f);return m;}
        public static GameObject Box(Transform root,string name,Vector3 pos,Vector3 size,string color)=>Primitive(root,name,PrimitiveType.Cube,pos,size,color);
        static GameObject Sphere(Transform root,string name,Vector3 pos,Vector3 size,string color)=>Primitive(root,name,PrimitiveType.Sphere,pos,size,color);
        static GameObject Cylinder(Transform root,string name,Vector3 pos,float radius,float height,string color)=>Primitive(root,name,PrimitiveType.Cylinder,pos,new Vector3(radius*2,height/2,radius*2),color);
        static GameObject Primitive(Transform root,string name,PrimitiveType kind,Vector3 pos,Vector3 size,string color){var o=GameObject.CreatePrimitive(kind);o.name=name;o.transform.SetParent(root,false);o.transform.localPosition=ToUnity(pos);o.transform.localScale=size;o.GetComponent<Renderer>().material=Material(color);return o;}
        TextMesh Label(Transform parent,string text,Vector3 pos,float size)
        {
            var o=new GameObject("Label");o.transform.SetParent(parent,false);o.transform.localPosition=ToUnity(pos);
            var t=o.AddComponent<TextMesh>();t.text=text;t.font=font;t.fontSize=64;t.characterSize=size;t.anchor=TextAnchor.MiddleCenter;t.alignment=TextAlignment.Center;t.color=Color.white;
            o.GetComponent<Renderer>().material=font.material;return t;
        }
        static string WorldName(string kind)=>kind=="cafe"?"カフェ":kind=="game"?"ゲーム":"ホール";
        static string KindName(string k)=>new Dictionary<string,string>{{"note","付箋"},{"hammer","ピコピコハンマー"},{"chess","チェス"},{"chessAi","チェス AI"},{"canvas","キャンバス"},{"camera","カメラ"},{"dice","サイコロ"},{"g2048","2048"},{"image","画像"},{"video","動画"},{"youtube","YouTube"}}.TryGetValue(k??"",out var n)?n:k;
        static string Wrap(string text,int columns)=>string.Join("\n",Enumerable.Range(0,Mathf.CeilToInt(text.Length/(float)columns)).Select(i=>text.Substring(i*columns,Math.Min(columns,text.Length-i*columns))));
        static string GridText(JArray grid,int width)=>grid==null?"":string.Join("\n",Enumerable.Range(0,grid.Count/width).Select(r=>string.Join("   ",grid.Skip(r*width).Take(width).Select(v=>((int)v)==0?"・":v.ToString()))));
    }
}
