using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        TextMesh gameStartLabel, gameJoinLabel, gameMonitorPhase, gameMonitorBody;
        GameObject gameStartButton;
        float nextEnvironmentRefresh;
        string gameDisplayKey;
        int environmentRound = -1;

        static Material Unlit(string color, float opacity)
        {
            var material = new Material(Shader.Find("Sprites/Default"));
            var value = ColorValue(color); value.a = opacity; material.color = value;
            return material;
        }

        static GameObject FlatSurface(Transform root, string name, Vector3 position, float width, float height, string color, bool floor = false, bool unlit = false)
        {
            var obj = new GameObject(name); obj.transform.SetParent(root, false); obj.transform.localPosition = ToUnity(position);
            if (floor) obj.transform.localRotation = Quaternion.Euler(90, 0, 0);
            var mesh = new Mesh { name = "Tonarium " + name };
            mesh.vertices = new[] { new Vector3(-width/2,-height/2,0), new Vector3(width/2,-height/2,0), new Vector3(width/2,height/2,0), new Vector3(-width/2,height/2,0) };
            mesh.uv = new[] { new Vector2(0,0), new Vector2(1,0), new Vector2(1,1), new Vector2(0,1) };
            mesh.triangles = new[] { 0,2,1,0,3,2 }; mesh.RecalculateNormals(); mesh.RecalculateBounds();
            obj.AddComponent<MeshFilter>().sharedMesh = mesh;
            obj.AddComponent<MeshRenderer>().sharedMaterial = unlit ? Unlit(color,1) : Material(color);
            return obj;
        }

        static void FloorGrid(Transform root, Vector3 position, float size, int divisions, string centerColor, string color, bool linearColors = false)
        {
            var vertices = new List<Vector3>(); var colors = new List<Color>();
            for (int i=0;i<=divisions;i++)
            {
                float n = -size/2+i*size/divisions;
                vertices.Add(new Vector3(n,.005f,-size/2)); vertices.Add(new Vector3(n,.005f,size/2));
                vertices.Add(new Vector3(-size/2,.005f,n)); vertices.Add(new Vector3(size/2,.005f,n));
                var value=ColorValue(i*2==divisions?centerColor:color);
                if (linearColors) value = value.linear;
                for(int j=0;j<4;j++) colors.Add(value);
            }
            var mesh = new Mesh { name = "Tonarium floor grid" }; mesh.SetVertices(vertices); mesh.SetColors(colors);
            mesh.SetIndices(Enumerable.Range(0,vertices.Count).ToArray(),MeshTopology.Lines,0); mesh.RecalculateBounds();
            var obj = new GameObject("Floor grid"); obj.transform.SetParent(root,false); obj.transform.localPosition=ToUnity(position);
            obj.AddComponent<MeshFilter>().sharedMesh=mesh; obj.AddComponent<MeshRenderer>().sharedMaterial=Unlit("#ffffff",1);
        }

        static void FloorArea(Transform root, string name, Vector3 position, float radius, float ringWidth, string color, float opacity, float ringOpacity)
        {
            FloorRing(root,name+" fill",position+Vector3.up*.006f,0,radius,color,opacity,48);
            FloorRing(root,name+" ring",position+Vector3.up*.008f,radius-ringWidth,radius,color,ringOpacity,64);
        }

        static void FloorRing(Transform root,string name,Vector3 position,float inner,float outer,string color,float opacity,int segments)
        {
            var vertices=new Vector3[(segments+1)*2]; var triangles=new int[segments*6];
            for(int i=0;i<=segments;i++)
            {
                float a=i*Mathf.PI*2/segments;
                vertices[i*2]=new Vector3(Mathf.Cos(a)*inner,0,Mathf.Sin(a)*inner);
                vertices[i*2+1]=new Vector3(Mathf.Cos(a)*outer,0,Mathf.Sin(a)*outer);
                if(i==segments)continue;
                int k=i*6; triangles[k]=i*2;triangles[k+1]=i*2+2;triangles[k+2]=i*2+1;
                triangles[k+3]=i*2+1;triangles[k+4]=i*2+2;triangles[k+5]=i*2+3;
            }
            var mesh=new Mesh{name="Tonarium "+name,vertices=vertices,triangles=triangles};mesh.RecalculateNormals();mesh.RecalculateBounds();
            var obj=new GameObject(name);obj.transform.SetParent(root,false);obj.transform.localPosition=ToUnity(position);
            obj.AddComponent<MeshFilter>().sharedMesh=mesh;obj.AddComponent<MeshRenderer>().sharedMaterial=Unlit(color,opacity);
        }

        static Texture2D PlankTexture()
        {
            const int size=1024,rowHeight=64;
            var pixels=new Color32[size*size];
            for(int row=0;row<16;row++)
            {
                int x=-(row*397%600);
                while(x<size)
                {
                    int length=380+(row*131+x)%260;
                    float light=(36+(row*7+x)%5)/100f;
                    var plank=Hsl(25/360f,.38f,light);
                    for(int px=Mathf.Max(0,x);px<Mathf.Min(size,x+length);px++)
                        for(int y=row*rowHeight;y<(row+1)*rowHeight;y++)pixels[(size-1-y)*size+px]=plank;
                    for(int px=Mathf.Max(0,x);px<Mathf.Min(size,x+3);px++)
                        for(int y=row*rowHeight;y<(row+1)*rowHeight;y++) pixels[(size-1-y)*size+px]=Color.Lerp(plank,new Color32(40,22,10,255),.55f);
                    x+=length;
                }
                for(int y=row*rowHeight;y<row*rowHeight+2;y++)for(int px=0;px<size;px++)
                    pixels[(size-1-y)*size+px]=Color.Lerp(pixels[(size-1-y)*size+px],new Color32(40,22,10,255),.6f);
            }
            var texture=new Texture2D(size,size,TextureFormat.RGB24,true){name="Web cafe planks",wrapMode=TextureWrapMode.Repeat,filterMode=FilterMode.Trilinear,anisoLevel=4};
            texture.SetPixels32(pixels);texture.Apply(true,true);return texture;
        }

        static Color Hsl(float hue,float saturation,float light)
        {
            float c=(1-Mathf.Abs(2*light-1))*saturation,h=hue*6,x=c*(1-Mathf.Abs(h%2-1)),m=light-c/2;
            return (h<1?new Color(c,x,0):h<2?new Color(x,c,0):h<3?new Color(0,c,x):h<4?new Color(0,x,c):h<5?new Color(x,0,c):new Color(c,0,x))+new Color(m,m,m,0);
        }

        static GameObject Taper(Transform root,string name,Vector3 position,float top,float bottom,float height,string color,int segments,bool solid=true,bool caps=true)
        {
            var vertices=new List<Vector3>();var triangles=new List<int>();
            for(int i=0;i<=segments;i++)
            {
                float a=i*Mathf.PI*2/segments;
                vertices.Add(new Vector3(Mathf.Sin(a)*bottom,-height/2,Mathf.Cos(a)*bottom));
                vertices.Add(new Vector3(Mathf.Sin(a)*top,height/2,Mathf.Cos(a)*top));
                if(i==segments)continue;
                int p=i*2;triangles.AddRange(new[]{p,p+2,p+1,p+2,p+3,p+1});
            }
            if(caps)
            {
                int b=vertices.Count;vertices.Add(new Vector3(0,-height/2,0));vertices.Add(new Vector3(0,height/2,0));
                for(int i=0;i<segments;i++)triangles.AddRange(new[]{b,i*2+2,i*2,b+1,i*2+1,i*2+3});
            }
            else
            {
                int count=triangles.Count,offset=vertices.Count;
                vertices.AddRange(vertices.ToArray());
                for(int i=0;i<count;i+=3)triangles.AddRange(new[]{triangles[i]+offset,triangles[i+2]+offset,triangles[i+1]+offset});
            }
            var mesh=new Mesh{name="Tonarium "+name};mesh.SetVertices(vertices);mesh.SetTriangles(triangles,0);mesh.RecalculateNormals();mesh.RecalculateBounds();
            var obj=new GameObject(name);obj.transform.SetParent(root,false);obj.transform.localPosition=ToUnity(position);
            obj.AddComponent<MeshFilter>().sharedMesh=mesh;obj.AddComponent<MeshRenderer>().sharedMaterial=Material(color);
            if(solid){var collider=obj.AddComponent<MeshCollider>();collider.sharedMesh=mesh;collider.convex=true;}
            return obj;
        }

        static void Icosahedron(Transform root,string name,Vector3 position,float radius,string color)
        {
            float t=(1+Mathf.Sqrt(5))/2;
            var points=new[]{new Vector3(-1,t,0),new Vector3(1,t,0),new Vector3(-1,-t,0),new Vector3(1,-t,0),new Vector3(0,-1,t),new Vector3(0,1,t),new Vector3(0,-1,-t),new Vector3(0,1,-t),new Vector3(t,0,-1),new Vector3(t,0,1),new Vector3(-t,0,-1),new Vector3(-t,0,1)};
            var faces=new[]{0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1};
            var vertices=faces.Select(i=>points[i].normalized*radius).ToArray();
            var mesh=new Mesh{name="Tonarium "+name,vertices=vertices,triangles=Enumerable.Range(0,vertices.Length).ToArray()};mesh.RecalculateNormals();mesh.RecalculateBounds();
            var obj=new GameObject(name);obj.transform.SetParent(root,false);obj.transform.localPosition=ToUnity(position);
            obj.AddComponent<MeshFilter>().sharedMesh=mesh;obj.AddComponent<MeshRenderer>().sharedMaterial=Material(color);
        }

        TextMesh FloatingLabel(Transform root,string text,Vector3 position,float height,string background)
        {
            var holder=new GameObject("World label");holder.transform.SetParent(root,false);holder.transform.localPosition=ToUnity(position);holder.AddComponent<FaceCamera>();
            var label=Label(holder.transform,text,Vector3.zero,height*10/68);label.name="Text";label.fontSize=48;
            var plate=FlatSurface(holder.transform,"Label background",new Vector3(0,0,-.002f),Mathf.Max(height,text.Length*height*.58f),height,background,false,true);
            plate.GetComponent<Renderer>().sharedMaterial.color=new Color(ColorValue(background).r,ColorValue(background).g,ColorValue(background).b,.85f);
            return label;
        }

        void BuildGameMonitor(Transform root)
        {
            var monitor=new GameObject("Game monitor");monitor.transform.SetParent(root,false);monitor.transform.localPosition=ToUnity(new Vector3(-9.85f,2.4f,-3));monitor.transform.localRotation=Quaternion.Euler(0,-90,0);
            Box(monitor.transform,"Monitor frame",new Vector3(0,0,-.03f),new Vector3(6.6f,3.9f,.06f),"#0c0d22");
            FlatSurface(monitor.transform,"Monitor display",new Vector3(0,0,.01f),6.4f,3.6f,"#14163a",false,true);
            FlatSurface(monitor.transform,"Monitor header",new Vector3(0,1.56f,.02f),6.4f,.48f,"#2b2f7a",false,true);
            var title=MonitorText(monitor.transform,"板わたりサバイバル",new Vector3(-3,1.55f,.03f),.27f,TextAnchor.MiddleLeft);title.fontStyle=FontStyle.Bold;
            gameMonitorPhase=MonitorText(monitor.transform,"参加者募集中",new Vector3(3,1.55f,.03f),.17f,TextAnchor.MiddleRight);
            gameMonitorBody=MonitorText(monitor.transform,"",new Vector3(-3,1.05f,.03f),.18f,TextAnchor.UpperLeft);
            nextEnvironmentRefresh=0;gameDisplayKey=null;
        }

        TextMesh MonitorText(Transform root,string text,Vector3 position,float height,TextAnchor anchor)
        {
            var label=Label(root,text,position,height*10/64);label.anchor=anchor;label.alignment=anchor==TextAnchor.MiddleRight?TextAlignment.Right:TextAlignment.Left;
            label.fontStyle=FontStyle.Bold;label.richText=true;return label;
        }

        public void RefreshWorldEnvironment()
        {
            if(world!="game")return;
            string[] colors={"#ff7a8a","#ffb347","#ffe066","#7ee08a","#6ec6ff"};
            int currentRound=(int?)game["round"]??0;
            if(environmentRound!=currentRound)
            {
                environmentRound=currentRound;
                foreach(var pair in tiles)
                {
                    pair.Value.transform.localPosition=ToUnity(TilePosition(pair.Key)-Vector3.up*.125f);
                    pair.Value.GetComponent<Renderer>().material.color=ColorValue(colors[pair.Key/64]);
                }
            }
            foreach(var pair in brokenTiles)
            {
                if(!tiles.TryGetValue(pair.Key,out var tile))continue;
                long left=pair.Value-Now;
                if(left<=0){tile.SetActive(false);continue;}
                float progress=Mathf.Clamp01(1-left/600f),shake=progress*.06f;
                tile.transform.localPosition=ToUnity(TilePosition(pair.Key)+new Vector3(Mathf.Sin(Now/17f+pair.Key)*shake,-.125f,Mathf.Cos(Now/23f+pair.Key)*shake));
                tile.GetComponent<Renderer>().material.color=Color.Lerp(ColorValue(colors[pair.Key/64]),ColorValue("#ff3b30"),.4f+progress*.6f);
            }
            if(Time.unscaledTime<nextEnvironmentRefresh)return;nextEnvironmentRefresh=Time.unscaledTime+.2f;
            var joiners=users.OfType<JObject>().Where(u=>(string)u["mode"]=="3d"&&(string)u["session"]==sessionId).Where(u=>
            {
                var id=(string)u["id"];Vector3 p;
                if(id==selfId)p=controller.transform.position;
                else if(avatarStates.TryGetValue(id,out var state))p=Position(state);else return false;
                return p.y>-.5f&&Vector2.Distance(new Vector2(p.x,-p.z),new Vector2(5.5f,-6.5f))<=1.8f;
            }).Select(u=>(string)u["name"]).ToArray();
            string phase=(string)game["phase"]??"idle",winner=(string)game["winner"];
            var players=(game["players"]as JArray??new JArray()).OfType<JObject>().ToArray();
            string key=phase+"|"+winner+"|"+string.Join(",",joiners)+"|"+game["round"]+"|"+string.Join(",",players.Select(p=>p.ToString()));
            if(gameDisplayKey==key)return;gameDisplayKey=key;
            if(gameJoinLabel!=null)gameJoinLabel.text="参加エリア（"+joiners.Length+" 人）";
            bool ready=phase=="idle"&&joiners.Length>=2;
            if(gameStartLabel!=null)gameStartLabel.text=ready?"ゲーム開始":phase=="idle"?"あと "+Math.Max(0,2-joiners.Length)+" 人":"ゲーム中";
            if(gameStartButton!=null){var m=gameStartButton.GetComponent<Renderer>().material;m.color=ColorValue(ready?"#ff3b5c":"#7a7d99");m.EnableKeyword("_EMISSION");m.SetColor("_EmissionColor",ready?ColorValue("#ff3b5c")*.5f:Color.black);}
            if(gameMonitorPhase!=null)gameMonitorPhase.text=phase=="running"?"プレイ中 · 残り "+players.Count(p=>p["out"]==null||p["out"].Type==JTokenType.Null)+" 人":phase=="ended"?"決着！":"参加者募集中";
            var lines=new List<string>();string winnerName=players.FirstOrDefault(p=>(string)p["id"]==winner)?["name"]?.ToString();
            if(phase=="ended"&&!string.IsNullOrEmpty(winnerName))lines.Add("<color=#ffd34d>"+winnerName+" の優勝！</color>\n");
            if(phase=="idle")
            {
                lines.Add("<color=#cfd3ff>参加エリアに入って、横のボタンでスタート（2 人から）</color>\n");
                lines.Add("参加エリア："+(joiners.Length==0?"まだ誰もいません":string.Join("、",joiners))+"\n");
                if(!string.IsNullOrEmpty(winnerName))lines.Add("<color=#ffd34d>前回の優勝："+winnerName+"</color>\n");
            }
            var ranked=phase=="running"?players:players.OrderByDescending(p=>(long?)p["out"]??long.MaxValue).ToArray();
            for(int i=0;i<Math.Min(9,ranked.Length);i++)
            {
                var p=ranked[i];bool alive=p["out"]==null||p["out"].Type==JTokenType.Null;string place=phase=="running"?(alive?"生存中":"脱落"):(i+1)+" 位";
                lines.Add("<color="+((string)p["id"]==winner?"#ffd34d":alive?"#8ef0a8":"#9aa0c8")+">"+place+"</color>　　　 "+p["name"]);
            }
            if(gameMonitorBody!=null)gameMonitorBody.text=string.Join("\n",lines);
        }
    }

    public sealed class WorldEnvironmentAnimation : MonoBehaviour
    {
        public TonariumWorld Owner;
        void LateUpdate(){if(Owner!=null)Owner.RefreshWorldEnvironment();}
    }
}
