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
            ClearSurvivorScene(); survivor = new JObject();
            world = kind; notice = "";
            if (environment != null) Destroy(environment);
            environment = new GameObject("World " + kind); tiles.Clear(); brokenTiles.Clear();
            RenderSettings.ambientMode = kind == "room" ? UnityEngine.Rendering.AmbientMode.Flat : UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.skybox = null;
            RenderSettings.ambientLight = Color.white * 1.4f;
            RenderSettings.ambientSkyColor = ColorValue(kind == "cafe" ? "#fff2dc" : "#e6f2ff") * (kind == "cafe" ? .6f : .8f);
            RenderSettings.ambientEquatorColor = kind == "cafe" ? ColorValue("#ffe9cc") * .75f : Color.white * .9f;
            RenderSettings.ambientGroundColor = ColorValue(kind == "cafe" ? "#5a3826" : "#3b3f6b") * (kind == "cafe" ? .6f : .8f);
            RenderSettings.fog = false;
            eye.backgroundColor = ColorValue(kind == "game" ? "#7fb6e6" : kind == "cafe" ? "#1f1a17" : "#2b2d31");
            var light = new GameObject("Sun").AddComponent<Light>(); light.transform.SetParent(environment.transform); light.type = LightType.Directional;
            light.intensity = kind == "cafe" ? .7f : kind == "game" ? 1.3f : 1.2f;
            light.color = ColorValue(kind == "cafe" ? "#ffe0b8" : "#ffffff");
            light.transform.rotation = Quaternion.LookRotation(ToUnity(-(kind == "cafe" ? new Vector3(4,10,6) : kind == "game" ? new Vector3(6,30,10) : new Vector3(5,10,5))));
            light.shadows = LightShadows.None;
            if (kind == "survivors")
            {
                // Three の Lambert 拡散項（1/π）を Unity の照度へ換算する。
                RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
                RenderSettings.ambientLight = (Color.white * (1.4f / Mathf.PI)).gamma;
                light.intensity = 1.2f / Mathf.PI;
            }
            Box(environment.transform, "Floor", new Vector3(0,-.1f,0), new Vector3(20,.2f,20), kind == "cafe" ? "#8a5a3b" : kind == "game" ? "#3b3f6b" : "#565961");
            string wall = kind == "cafe" ? "#eadcc4" : kind == "game" ? "#2a2d52" : "#80848e";
            Box(environment.transform,"South",new Vector3(0,2,10),new Vector3(20,4,.2f),wall);
            Box(environment.transform,"West",new Vector3(-10,2,0),new Vector3(.2f,4,20),wall);
            Box(environment.transform,"East",new Vector3(10,2,0),new Vector3(.2f,4,20),wall);
            var north = Box(environment.transform,"North",new Vector3(0,2,-10),new Vector3(20,4,.2f),wall);
            if (kind == "game")
            {
                north.GetComponent<Renderer>().enabled=false;
                // Standard の透明variantの有無に依存せず、Webと同じ18%の透けを保つ。
                var glassPane=FlatSurface(environment.transform,"Glass",new Vector3(0,2,-10),20,4,"#bfe6ff",false,true);
                var glassColor=ColorValue("#bfe6ff");glassColor.a=.18f;
                glassPane.GetComponent<Renderer>().sharedMaterial.color=glassColor;
                Box(environment.transform,"Glass top frame",new Vector3(0,4,-10),new Vector3(20,.12f,.12f),"#d9dcff");
                Box(environment.transform,"Glass bottom frame",new Vector3(0,.05f,-10),new Vector3(20,.1f,.12f),"#d9dcff");
            }
            FloorArea(environment.transform,"Spawn",new Vector3(0,0,6.5f),1.6f,.06f,kind == "cafe" ? "#ffd28a" : kind == "game" ? "#9cf0ff" : "#7fb3ff",.16f,.8f);
            if (kind == "cafe") BuildCafe();
            else if (kind == "game") BuildGame();
            else FloorGrid(environment.transform, Vector3.zero, 20,20,"#5c5f66","#4a4d54", kind == "survivors");
            if (kind == "survivors") BuildSurvivorEnvironment();
        }

        public void SetPreviewCamera(string kind)
        {
            controller.enabled = false;
            // Web と同じ足元の座標を使い、カメラの眼高を二重に足さない。
            controller.transform.position = ToUnity(new Vector3(0,0,6.5f));
            controller.transform.rotation = Quaternion.identity;
            eye.transform.localPosition = new Vector3(0,1.6f,0);
            eye.transform.localRotation = Quaternion.identity;
            yaw=0;pitch=0;
            controller.enabled = true;
        }

        void BuildCafe()
        {
            var r=environment.transform;
            var floor=FlatSurface(r,"Wood plank floor",new Vector3(0,.001f,0),20,20,"#ffffff",true);
            var wood=PlankTexture(); floor.GetComponent<Renderer>().material.mainTexture=wood; floor.GetComponent<Renderer>().material.mainTextureScale=new Vector2(6,6);
            Box(r,"North wainscot",new Vector3(0,.55f,-9.87f),new Vector3(20,1.1f,.06f),"#7a5038");
            Box(r,"East wainscot",new Vector3(9.87f,.55f,0),new Vector3(.06f,1.1f,20),"#7a5038");
            Box(r,"South wainscot",new Vector3(0,.55f,9.87f),new Vector3(20,1.1f,.06f),"#7a5038");
            var ceiling=FlatSurface(r,"Ceiling",new Vector3(0,4,0),20,20,"#6b4a36",true); ceiling.transform.localRotation=Quaternion.Euler(-90,0,0);
            Box(r,"Counter",new Vector3(-8.3f,.5f,-1),new Vector3(1.1f,1,8),"#5a3826");
            Box(r,"Countertop",new Vector3(-8.25f,1.03f,-1),new Vector3(1.3f,.06f,8.1f),"#d8c3a0");
            Box(r,"Coffee machine",new Vector3(-8.45f,1.3f,-3.4f),new Vector3(.55f,.5f,.7f),"#b9bcc0");
            Box(r,"Coffee machine top",new Vector3(-8.45f,1.6f,-3.4f),new Vector3(.45f,.1f,.6f),"#2b2b2e");
            foreach(float dz in new[]{-.6f,-.3f,.9f,1.2f}) Taper(r,"Counter cup",new Vector3(-8.1f,1.11f,-1+dz),.05f,.04f,.1f,"#fbf7ef",24);
            Box(r,"Shelf",new Vector3(-9.6f,1.1f,-1),new Vector3(.5f,2.2f,8),"#6b4630");
            string[] jars={"#c7843f","#e0c08a","#7a4a2a","#b85c3c","#d9b76a","#8f6a3d"};
            foreach(float y in new[]{.8f,1.45f,2.05f})
            {
                Box(r,"Shelf board",new Vector3(-9.28f,y,-1),new Vector3(.36f,.04f,7.8f),"#8c6243");
                for(int j=0;j<9;j++) Taper(r,"Jar",new Vector3(-9.28f,y+.13f,-4.4f+j*.85f),.09f,.09f,.22f,jars[(j+Mathf.RoundToInt(y*3))%jars.Length],12);
            }
            for(int i=0;i<5;i++) { Taper(r,"Stool leg",new Vector3(-7.25f,.38f,-4.2f+i*1.6f),.04f,.04f,.76f,"#2e2e30",8); Cylinder(r,"Stool foot",new Vector3(-7.25f,.02f,-4.2f+i*1.6f),.2f,.04f,"#2e2e30"); Cylinder(r,"Stool seat",new Vector3(-7.25f,.78f,-4.2f+i*1.6f),.2f,.07f,"#7b3f2a"); }
            Vector2[] tables={new Vector2(3.2f,-3.5f),new Vector2(6.8f,-3.5f),new Vector2(3.2f,.5f),new Vector2(6.8f,.5f),new Vector2(-3.8f,4.2f)};
            foreach(var p in tables)
            {
                Cylinder(r,"Table",new Vector3(p.x,.74f,p.y),.5f,.04f,"#c49a6c"); Taper(r,"Table leg",new Vector3(p.x,.37f,p.y),.04f,.04f,.72f,"#2e2e30",8);
                Cylinder(r,"Table foot",new Vector3(p.x,.02f,p.y),.25f,.04f,"#2e2e30");
                Taper(r,"Cup",new Vector3(p.x+.12f,.8f,p.y+.05f),.045f,.035f,.09f,"#fbf7ef",12);
                Chair(r,p.x+.85f,p.y,90); Chair(r,p.x-.85f,p.y,-90); Pendant(r,p.x,p.y);
            }
            Box(r,"Sofa",new Vector3(9.25f,.22f,5),new Vector3(.9f,.44f,3.6f),"#6e3b33");
            Box(r,"Sofa back",new Vector3(9.58f,.7f,5),new Vector3(.24f,.6f,3.6f),"#6e3b33");
            for(int i=-1;i<=1;i++)Box(r,"Cushion",new Vector3(9.17f,.5f,5+i*1.2f),new Vector3(.7f,.14f,1.12f),"#8a4a40");
            Box(r,"Low table",new Vector3(7.9f,.42f,5),new Vector3(.8f,.05f,1.8f),"#c49a6c");
            Box(r,"Low table base",new Vector3(7.9f,.2f,5),new Vector3(.6f,.4f,1.6f),"#5a3826"); Pendant(r,8.3f,5);
            foreach(var p in new[]{new Vector2(8.9f,-8.9f),new Vector2(-8.9f,8.9f),new Vector2(8.9f,8.9f),new Vector2(-3.2f,-8.9f)})
            { Taper(r,"Pot",new Vector3(p.x,.25f,p.y),.3f,.22f,.5f,"#c46a43",24); Icosahedron(r,"Plant",new Vector3(p.x,.95f,p.y),.5f,"#4f7d45"); Icosahedron(r,"Plant tip",new Vector3(p.x+.15f,1.35f,p.y-.05f),.32f,"#5f9452"); }
            for(int z=-6;z<=6;z+=4) Box(r,"Beam",new Vector3(0,3.88f,z),new Vector3(20,.24f,.3f),"#5a3826");
            var menuBoard=FlatSurface(r,"Menu",new Vector3(-9.88f,3.05f,-1),2.6f,1.62f,"#ffffff"); menuBoard.transform.localRotation=Quaternion.Euler(0,-90,0);
            menuBoard.GetComponent<Renderer>().material.mainTexture=Resources.Load<Texture2D>("CafeMenu");
        }
        void Chair(Transform root,float x,float z,float rotation)
        {
            var c=new GameObject("Chair");c.transform.SetParent(root); c.transform.localPosition=ToUnity(new Vector3(x,0,z));c.transform.localRotation=Quaternion.Euler(0,-rotation,0);
            Box(c.transform,"Seat",new Vector3(0,.45f,0),new Vector3(.44f,.05f,.42f),"#9a6a45");Box(c.transform,"Back",new Vector3(0,.78f,.19f),new Vector3(.44f,.5f,.05f),"#9a6a45");
            for(int a=-1;a<=1;a+=2)for(int b=-1;b<=1;b+=2)Box(c.transform,"Leg",new Vector3(a*.18f,.22f,b*.17f),new Vector3(.04f,.44f,.04f),"#5a3826");
        }
        void Pendant(Transform root,float x,float z)
        {
            Taper(root,"Cord",new Vector3(x,3.35f,z),.008f,.008f,1.3f,"#222222",4,false);
            Taper(root,"Shade",new Vector3(x,2.62f,z),0,.26f,.24f,"#2f2a26",20,false,false);
            var bulb=Sphere(root,"Bulb",new Vector3(x,2.54f,z),Vector3.one*.14f,"#ffe3a8"); bulb.GetComponent<Renderer>().material=Unlit("#ffe3a8",1); Destroy(bulb.GetComponent<Collider>());
            var l=new GameObject("Warm light").AddComponent<Light>();l.transform.SetParent(root);l.transform.localPosition=ToUnity(new Vector3(x,2.4f,z));l.type=LightType.Point;l.range=6;l.intensity=1.7f;l.color=ColorValue("#ffcf8a");
        }
        void BuildGame()
        {
            var r=environment.transform;
            environmentRound=-1;
            FloorGrid(r,Vector3.zero,20,20,"#5a5f9a","#474b80");
            for(int i=0;i<320;i++)
            {
                var t=Box(r,"Tile "+i,TilePosition(i)-Vector3.up*.125f,new Vector3(1.42f,.25f,1.42f),new[]{"#ff7a8a","#ffb347","#ffe066","#7ee08a","#6ec6ff"}[i/64]);
                t.AddComponent<GameTile>().Index=i;tiles[i]=t;
            }
            var start=Taper(r,"Start game",new Vector3(8.6f,.5f,-6.5f),.35f,.42f,1,"#2a2d52",24);start.AddComponent<GameStart>();
            gameStartButton=Taper(r,"Start button",new Vector3(8.6f,1.06f,-6.5f),.24f,.26f,.12f,"#7a7d99",24);gameStartButton.AddComponent<GameStart>();
            gameStartLabel=FloatingLabel(r,"あと 2 人",new Vector3(8.6f,1.55f,-6.5f),.2f,"#282c5a");
            gameJoinLabel=FloatingLabel(r,"参加エリア（0 人）",new Vector3(5.5f,2.3f,-6.5f),.24f,"#785a00");
            FloorArea(r,"Join area",new Vector3(5.5f,0,-6.5f),1.8f,.08f,"#ffd34d",.22f,1);
            for(int x=-1;x<=1;x+=2)for(int z=-1;z<=1;z+=2)Box(r,"Tower",new Vector3(x*6.3f,7,-20+z*6.3f),new Vector3(.4f,30,.4f),"#d9dcff");
            for(int i=0;i<5;i++) FloatingLabel(r,(i+1)+" 階",new Vector3(-6.3f,new[]{20,15,10,5,0}[i]+1.2f,-13.7f),.5f,"#282c5a");
            FlatSurface(r,"Abyss",new Vector3(0,-8,-18),20,20,"#1a1030",true,true);
            FloorGrid(r,new Vector3(0,-8,-20),20,16,"#ff4f8b","#5a2a6e");
            BuildGameMonitor(r);
            var updater=environment.AddComponent<WorldEnvironmentAnimation>();updater.Owner=this;
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
        static string WorldName(string kind)=>kind=="cafe"?"カフェ":kind=="game"?"ゲーム":kind=="survivors"?"宵闇サバイバーズ":"ホール";
        static string KindName(string k)=>new Dictionary<string,string>{{"note","付箋"},{"hammer","ピコピコハンマー"},{"chess","チェス"},{"chessAi","チェス AI"},{"canvas","キャンバス"},{"camera","カメラ"},{"dice","サイコロ"},{"g2048","2048"},{"image","画像"},{"video","動画"},{"youtube","YouTube"}}.TryGetValue(k??"",out var n)?n:k;
        static string Wrap(string text,int columns)=>string.Join("\n",Enumerable.Range(0,Mathf.CeilToInt(text.Length/(float)columns)).Select(i=>text.Substring(i*columns,Math.Min(columns,text.Length-i*columns))));
        static string GridText(JArray grid,int width)=>grid==null?"":string.Join("\n",Enumerable.Range(0,grid.Count/width).Select(r=>string.Join("   ",grid.Skip(r*width).Take(width).Select(v=>((int)v)==0?"・":v.ToString()))));
    }
}
