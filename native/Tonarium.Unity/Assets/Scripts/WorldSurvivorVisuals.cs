using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        // client/src/view3d/survivors3d.tsx と同じ形状、座標、時間、色を使う。
        sealed class SurvivorVisualActor
        {
            public GameObject root, body, head, levelRing, hitRing, halo, groundRing, dashTrail, chargeLine, chargeMark;
            public TextMesh label;
            public JObject value;
            public bool enemy;
            public int level;
            public long levelAt;
        }
        sealed class SurvivorVisualAttack
        {
            public GameObject root, ring, projectile, beam, glow, impact;
            public string id;
            public GameObject[] sparks;
            public Vector3 from, to, areaCenter;
            public long at;
            public float reach;
        }
        readonly Dictionary<GameObject, SurvivorVisualActor> survivorVisualActors = new Dictionary<GameObject, SurvivorVisualActor>();
        readonly List<SurvivorVisualAttack> survivorVisualAttacks = new List<SurvivorVisualAttack>();
        readonly Dictionary<string, Mesh> survivorMeshes = new Dictionary<string, Mesh>();
        TextMesh survivorJoinLabel;
        long? survivorVisualProbeNow;
        long SurvivorVisualNow => survivorVisualProbeNow ?? Now;
        static readonly Dictionary<string, string> survivorAttackColors = new Dictionary<string, string>
        {
            ["moonblade"]="#ff65aa", ["eclipse"]="#ffe675", ["bloodaura"]="#ff315e", ["crimsonsun"]="#ff9d35",
            ["starbolt"]="#5fe5ff", ["starfall"]="#ffe16e", ["shade"]="#bc8aff", ["umbralstorm"]="#a457ff", ["frostlance"]="#8beaff", ["stormring"]="#7cbdff", ["embermine"]="#ff7c3b", ["thornshot"]="#93e86b", ["voidpulse"]="#d783ff", ["lunarconvergence"]="#fff29a", ["crimsonvoid"]="#ff174f", ["stormfrost"]="#70f4ff"
        };
        static bool SurvivorAreaWeapon(string gear) => new[] { "moonblade", "eclipse", "bloodaura", "crimsonsun", "starfall", "embermine", "voidpulse", "crimsonvoid" }.Contains(gear);
        static string SurvivorEnemyColor(string kind) => kind == "boss" ? "#a41142" : kind == "charger" ? "#e87927" : kind == "wisp" ? "#33c7c5" : kind == "knight" ? "#7b547a" : kind == "bat" ? "#513b77" : kind == "slinger" ? "#d39a37" : kind == "splitter" ? "#d95748" : kind == "shifter" ? "#9749bd" : kind == "pack" ? "#719d32" : kind == "bulwark" ? "#687b93" : "#7c3154";
        GameObject SurvivorBox(Transform parent, string name, string color, Vector3 size)
        {
            var obj = GameObject.CreatePrimitive(PrimitiveType.Cube); obj.name = name; obj.transform.SetParent(parent, false); obj.transform.localScale = size;
            Destroy(obj.GetComponent<Collider>()); obj.GetComponent<Renderer>().sharedMaterial = Unlit(color, .9f); return obj;
        }
        Transform SurvivorRoot()
        {
            if (survivorRoot == null) survivorRoot = new GameObject("Survivors");
            return survivorRoot.transform;
        }
        GameObject SurvivorGroup(Transform parent, string name, Vector3 position)
        {
            var obj = new GameObject(name); obj.transform.SetParent(parent, false); obj.transform.localPosition = position; return obj;
        }
        Mesh SurvivorMesh(string name)
        {
            if (survivorMeshes.TryGetValue(name, out var mesh)) return mesh;
            var data = JObject.Parse(Resources.Load<TextAsset>("Web/SurvivorMeshes").text)[name];
            var positions = data["positions"].Values<float>().ToArray(); var normals = data["normals"].Values<float>().ToArray();
            var vertices = new Vector3[positions.Length / 3]; var ns = new Vector3[vertices.Length];
            for (int i=0; i<vertices.Length; i++)
            { vertices[i] = new Vector3(positions[i*3], positions[i*3+1], -positions[i*3+2]); ns[i] = new Vector3(normals[i*3], normals[i*3+1], -normals[i*3+2]); }
            mesh = new Mesh { name = "Three.js " + name, vertices = vertices, normals = ns, triangles = Enumerable.Range(0, vertices.Length).ToArray() };
            mesh.RecalculateBounds(); survivorMeshes[name] = mesh; return mesh;
        }
        GameObject SurvivorPoly(Transform parent, string name, Vector3 position, float size, string shape, string color, bool unlit = false)
        {
            var obj=SurvivorGroup(parent,name,position); obj.transform.localScale=Vector3.one*size;
            obj.AddComponent<MeshFilter>().sharedMesh=SurvivorMesh(shape);
            obj.AddComponent<MeshRenderer>().sharedMaterial=unlit?Unlit(color,1):Material(color);
            return obj;
        }
        GameObject SurvivorRing(Transform parent, string name, float inner, float outer, string color, float opacity, int segments=48)
        {
            FloorRing(parent,name,Vector3.zero,inner,outer,color,opacity,segments);
            return parent.GetChild(parent.childCount-1).gameObject;
        }
        static void SurvivorEffectMaterial(GameObject obj, bool additive)
        {
            var renderer=obj.GetComponent<Renderer>(); var old=renderer.sharedMaterial;
            var material=new Material(Resources.Load<Shader>("SurvivorEffect"));material.color=old.color;
            material.SetFloat("_DstBlend",additive?1:10);renderer.sharedMaterial=material;Destroy(old);
        }
        static void SurvivorOpacity(GameObject obj, float opacity)
        {
            if (obj == null) return;
            var material=obj.GetComponent<Renderer>().sharedMaterial; var color=material.color; color.a=opacity; material.color=color;
        }
        static void SurvivorColor(GameObject obj, string color)
        { if(obj!=null)obj.GetComponent<Renderer>().sharedMaterial.color=ColorValue(color); }
        static void SurvivorGlow(GameObject obj, string color, float intensity)
        {
            var m=obj.GetComponent<Renderer>().sharedMaterial; m.EnableKeyword("_EMISSION"); m.SetColor("_EmissionColor",ColorValue(color)*intensity);
            m.SetFloat("_Glossiness",.45f);
        }
        GameObject CreateSurvivorActor(JObject value, bool enemy, int index)
        {
            var obj=SurvivorGroup(SurvivorRoot(),(enemy?"Enemy ":"Player ")+(string)value["id"],new Vector3(Float(value,"x"),0,-Float(value,"z")));
            var actor=new SurvivorVisualActor { root=obj, enemy=enemy, value=value, level=(int?)value["level"]??0 };
            survivorVisualActors[obj]=actor; obj.AddComponent<SurvivorVisualResources>();
            var p=obj.transform;
            if(enemy)
            {
                string kind=(string)value["kind"]; bool boss=kind=="boss";
                string color=SurvivorEnemyColor(kind);
                float size=boss?.72f:kind=="knight"||kind=="bulwark"?.42f:kind=="splitter"?.4f:kind=="charger"?.38f:kind=="wisp"||kind=="shifter"?.32f:.3f;
                actor.body=SurvivorPoly(p,"Body",Vector3.zero,size,boss||kind=="splitter"?"dodeca1":kind=="charger"?"cone6":kind=="pack"?"cone3":kind=="wisp"||kind=="shifter"?"octa1":kind=="slinger"||kind=="bulwark"?"enemyBox":"ico0",color);
                SurvivorGlow(actor.body,color,boss?.65f:.12f);
                if (boss || kind == "charger" || kind == "shifter") { actor.dashTrail = SurvivorBox(p, "Dash trail", boss ? "#fff0d8" : kind == "shifter" ? "#f2b7ff" : "#ffe6a0", new Vector3(1, .07f, .18f)); SurvivorEffectMaterial(actor.dashTrail, true); actor.dashTrail.SetActive(false); }
                if (kind == "charger")
                {
                    actor.chargeLine = SurvivorBox(SurvivorRoot(), "Charge telegraph", "#ff9b38", new Vector3(1, .035f, .16f)); actor.chargeLine.AddComponent<SurvivorVisualResources>();
                    actor.chargeMark = SurvivorRing(SurvivorRoot(), "Charge target", .45f, .55f, "#fff0b8", .75f, 6); actor.chargeMark.AddComponent<SurvivorVisualResources>();
                }
                if (kind == "charger" || kind == "wisp" || kind == "shifter" || kind == "bulwark")
                {
                    var ring = SurvivorRing(p, "Enemy ground ring", kind=="charger"?.43f:kind=="wisp"?.36f:kind=="shifter"?.39f:.52f, kind=="charger"?.5f:kind=="wisp"?.4f:kind=="shifter"?.44f:.58f, kind=="charger"?"#ff9b38":kind=="wisp"?"#8dfff4":kind=="shifter"?"#f2b7ff":"#c4d4e9", kind=="charger"?.78f:kind=="wisp"?.7f:kind=="shifter"?.72f:.62f, kind=="charger"||kind=="bulwark"?6:kind=="wisp"?32:24);
                    ring.transform.localPosition = Vector3.up * (kind=="charger"?.035f:kind=="bulwark"?.045f:.04f);
                    if (kind=="wisp") { var halo=SurvivorPoly(p,"Wisp halo",Vector3.up*.72f,1,"wispHalo","#81fff2",true); halo.transform.localRotation=Quaternion.Euler(90,0,0); SurvivorOpacity(halo,.78f); }
                }
                if(boss)
                {
                    // Webのicosahedron wireframeと同じ辺を描く。
                    var halo=SurvivorGroup(p,"Boss halo",Vector3.zero); var source=SurvivorMesh("ico0");
                    var edges=new List<int>(); for(int i=0;i<source.vertexCount;i+=3)edges.AddRange(new[]{i,i+1,i+1,i+2,i+2,i});
                    var mesh=new Mesh {vertices=source.vertices}; mesh.SetIndices(edges.ToArray(),MeshTopology.Lines,0); mesh.RecalculateBounds();
                    halo.AddComponent<MeshFilter>().sharedMesh=mesh;halo.AddComponent<MeshRenderer>().sharedMaterial=Unlit("#ff315d",.22f);
                    halo.transform.localScale=Vector3.one*(size*1.42f); actor.halo=halo;
                    actor.groundRing=SurvivorRing(p,"Boss ground ring",.9f,1.04f,"#ff456d",.7f);
                    actor.groundRing.transform.localPosition=Vector3.down*.94f;
                }
            }
            else
            {
                actor.levelRing=SurvivorRing(p,"Level ring",.72f,1,"#ffe7a0",0); actor.levelRing.transform.localPosition=Vector3.up*.045f; SurvivorEffectMaterial(actor.levelRing,true);
                actor.hitRing=SurvivorRing(p,"Hit ring",.72f,1,"#ff5577",0,40); actor.hitRing.transform.localPosition=Vector3.up*.052f; SurvivorEffectMaterial(actor.hitRing,true);
                var disc=SurvivorRing(p,"Player disc",0,.34f,SurvivorPlayerColor((string)value["id"]),.7f,32);disc.transform.localPosition=Vector3.up*.12f;
                Taper(p,"Body",new Vector3(0,.34f,0),.19f,.16f,.44f,"#ffe29a",24); actor.body=p.GetChild(p.childCount-1).gameObject;
                actor.head=SurvivorPoly(p,"Head",new Vector3(0,.64f,0),.12f,"head","#fff0d5");
                actor.label=SurvivorLabel(p,"",new Vector3(0,1.12f,0),.18f,"#371c37");
            }
            foreach(var collider in obj.GetComponentsInChildren<Collider>())Destroy(collider);
            return obj;
        }
        static string SurvivorPlayerColor(string id)
        {
            // store.ts colorOf と同じハッシュ。
            uint hash=0; foreach(char c in id??"")hash=unchecked(hash*31+c);
            var c0=Hsl((hash%360)/360f,.65f,.55f); return "#"+ColorUtility.ToHtmlStringRGB(c0);
        }
        void UpdateSurvivorActor(GameObject obj, JObject value, bool enemy, int index)
        {
            var actor=survivorVisualActors[obj]; actor.value=value;
            if(enemy)return;
            bool alive=(bool?)value["alive"]==true; int level=(int?)value["level"]??0;
            if(level>actor.level)actor.levelAt=Now;actor.level=level;
            SurvivorColor(actor.body,alive?(index==0?"#ffe29a":"#8ed9ff"):"#55515a");
            SurvivorColor(actor.head,alive?"#fff0d5":"#777777");
            actor.label.text=((string)SurvivorCatalog["styles"]?[(string)value["style"]??"bloodrose"]?["mark"]??"")+" "+(string)value["name"]+" · Lv."+level;
            SizeSurvivorLabel(actor.label, .18f, alive?"#371c37":"#2d2b31", alive?.92f:.9f);

        }
        void CreateSurvivorAttack(JObject effect)
        {
            string gear=(string)effect["gear"]??""; bool area=SurvivorAreaWeapon(gear);
            string color=survivorAttackColors.TryGetValue(gear,out var c)?c:"#fff3a6";int index=0;
            JObject previous = null;
            foreach(var target in (effect["targets"] as JArray??new JArray()).OfType<JObject>())
            {
                var root=SurvivorGroup(SurvivorRoot(),"Attack "+gear,Vector3.zero);survivorEffects.Add(root); root.AddComponent<SurvivorVisualResources>();
                var from=(bool?)effect["chain"] == true && previous != null ? previous : effect["from"] as JObject;
                var center=effect["areaCenter"] as JObject ?? effect["from"] as JObject;
                var a=new SurvivorVisualAttack {root=root,id=(string)effect["id"],at=(long?)effect["at"]??Now,reach=Float(effect,"reach"),areaCenter=new Vector3(Float(center,"x"),.055f,-Float(center,"z")),from=new Vector3(Float(from,"x"),.42f,-Float(from,"z")),to=new Vector3(Float(target,"x"),.42f,-Float(target,"z"))};
                if(area&&index==0)a.ring=SurvivorRing(root.transform,"Area ring",.82f,1,color,.9f);
                if(!area)
                {
                    a.projectile=SurvivorPoly(root.transform,"Projectile",Vector3.zero,.2f,"octa1",color,true);
                    a.beam=Cylinder(root.transform,"Beam",Vector3.zero,1,1,color);Destroy(a.beam.GetComponent<Collider>());a.beam.GetComponent<Renderer>().sharedMaterial=Unlit(color,.68f);
                    a.glow=Cylinder(root.transform,"Glow",Vector3.zero,1,1,color);Destroy(a.glow.GetComponent<Collider>());a.glow.GetComponent<Renderer>().sharedMaterial=Unlit(color,.3f);
                }
                a.impact=SurvivorRing(root.transform,"Impact",.72f,1,"#ffffff",.9f,32);
                a.sparks=Enumerable.Range(0,6).Select(i=>SurvivorPoly(root.transform,"Spark "+i,Vector3.zero,1,"octa0",i%2==1?color:"#fff6d9",true)).ToArray();
                foreach(var renderer in root.GetComponentsInChildren<Renderer>())
                    SurvivorEffectMaterial(renderer.gameObject,renderer.gameObject==a.glow||a.sparks.Contains(renderer.gameObject));
                survivorVisualAttacks.Add(a);index++;previous=target;
            }
        }
        void UpdateSurvivorVisuals()
        {
            foreach(var actor in survivorVisualActors.Values)
            {
                if(actor.root==null)continue;var v=actor.value;var t=actor.root.transform;
                if(actor.enemy)
                {
                    string kind=(string)v["kind"];bool boss=kind=="boss"; string color=SurvivorEnemyColor(kind);
                    if(actor.chargeLine!=null)
                    {
                        var target=v["chargeTarget"] as JObject; bool visible=target!=null && ((long?)v["chargeUntil"]??0) > (SurvivorPaused?(long)survivor["pausedAt"]:SurvivorVisualNow);
                        actor.chargeLine.SetActive(visible);actor.chargeMark.SetActive(visible);
                        if(visible) { var from=new Vector3(Float(v,"x"),.055f,-Float(v,"z"));var to=new Vector3(Float(target,"x"),.055f,-Float(target,"z"));var d=to-from;actor.chargeLine.transform.position=(from+to)*.5f;actor.chargeLine.transform.rotation=Quaternion.FromToRotation(Vector3.right,d);actor.chargeLine.transform.localScale=new Vector3(d.magnitude,.035f,.16f);actor.chargeMark.transform.position=to+Vector3.up*.005f;actor.chargeMark.transform.localScale=Vector3.one*(1+Mathf.Sin(Time.time*18)*.12f);float opacity=.5f+Mathf.Sin(Time.time*18)*.22f;SurvivorOpacity(actor.chargeLine,opacity);SurvivorOpacity(actor.chargeMark,opacity+.12f); }
                    }
                    if(SurvivorPaused)continue;
                    float y=boss?.95f+Mathf.Sin(Time.time*2)*.1f:kind=="wisp"?.72f+Mathf.Sin(Time.time*8+Float(v,"movePhase"))*.24f:kind=="shifter"?.58f+Mathf.Sin(Time.time*9+Float(v,"movePhase"))*.17f:.35f+Mathf.Sin(Time.time*5+Float(v,"x"))*.06f;
                    t.position=new Vector3(Float(v,"x"),y,-Float(v,"z"));
                    if(actor.dashTrail!=null)
                    {
                        var from=v["dashFrom"] as JObject;float remaining=((long?)v["dashUntil"]??0)-SurvivorVisualNow;
                        var d=from==null?Vector3.zero:new Vector3(Float(v,"x")-Float(from,"x"),0,-Float(v,"z")+Float(from,"z"));
                        actor.dashTrail.SetActive(from!=null&&remaining>0&&d.magnitude>.05f);
                        actor.dashTrail.transform.localPosition=-d*.5f+Vector3.up*.42f;actor.dashTrail.transform.localRotation=Quaternion.FromToRotation(Vector3.right,d.magnitude>.001f?d:Vector3.right);actor.dashTrail.transform.localScale=new Vector3(d.magnitude,.07f,.18f);SurvivorOpacity(actor.dashTrail,Mathf.Clamp01(remaining/(boss?520:kind=="shifter"?650:480))*.9f);
                    }
                    long hit=(long?)v["hitAt"]??0;float age=SurvivorVisualNow-hit;float flash=hit>0&&age>=0&&age<220?1-age/220:0;
                    t.localScale=Vector3.one*(1+flash*.28f);SurvivorGlow(actor.body,flash>0?"#ffffff":color,(boss?.65f:.12f)+flash*2.8f);
                    if(boss){float pulse=.5f+Mathf.Sin(Time.time*3.2f)*.5f;actor.halo.transform.localScale=Vector3.one*(.72f*1.42f*(1.08f+pulse*.12f));SurvivorOpacity(actor.halo,.16f+pulse*.16f);actor.groundRing.transform.localScale=Vector3.one*(1+pulse*.12f);SurvivorOpacity(actor.groundRing,.52f+pulse*.28f);}
                }
                else
                {
                    bool self=(string)v["id"]==selfId;var target=self?new Vector3(controller.transform.position.x,0,controller.transform.position.z):new Vector3(Float(v,"x"),0,-Float(v,"z"));
                    t.position=Vector3.Lerp(t.position,target,self?1:Mathf.Min(1,Time.deltaTime*10));
                    float age=SurvivorVisualNow-actor.levelAt,progress=Mathf.Clamp01(age/850);actor.levelRing.SetActive(actor.levelAt>0&&age>=0&&age<850);actor.levelRing.transform.localScale=Vector3.one*(.36f+progress*1.35f);SurvivorOpacity(actor.levelRing,Mathf.Sin(progress*Mathf.PI)*.9f);
                    long hit=(long?)v["hitAt"]??0;age=SurvivorVisualNow-hit;float flash=hit>0&&age>=0&&age<300?1-age/300:0;actor.hitRing.SetActive(flash>0);actor.hitRing.transform.localScale=Vector3.one*(.48f+(1-flash)*.55f);SurvivorOpacity(actor.hitRing,flash*.9f);
                }
            }
            for(int n=survivorVisualAttacks.Count-1;n>=0;n--)
            {
                var a=survivorVisualAttacks[n];float age=Mathf.Max(0,SurvivorVisualNow-a.at);if(a.root==null||age>650){if(a.root!=null)Destroy(a.root);survivorVisualAttacks.RemoveAt(n);continue;}
                float progress=Mathf.Min(1,age/650),fade=1-progress;
                if(a.ring!=null){a.ring.transform.position=a.areaCenter;a.ring.transform.localScale=Vector3.one*(.15f+a.reach*progress);SurvivorOpacity(a.ring,fade*.95f);}
                if(a.projectile!=null)
                {
                    var pos=Vector3.Lerp(a.from,a.to,progress);pos.y=.52f;a.projectile.transform.position=pos;SurvivorOpacity(a.projectile,fade);
                    var direction=a.to-a.from;float length=direction.magnitude;var mid=(a.from+a.to)*.5f;mid.y=.39f;
                    foreach(var beam in new[]{a.beam,a.glow}){beam.transform.position=mid;beam.transform.rotation=Quaternion.FromToRotation(Vector3.up,direction);beam.SetActive(length>.01f);float radius=beam==a.beam?.035f:.1f;beam.transform.localScale=new Vector3(radius*2,length*.5f,radius*2);SurvivorOpacity(beam,fade*(beam==a.beam?.68f:.3f));}
                }
                a.impact.transform.position=new Vector3(a.to.x,.06f,a.to.z);a.impact.transform.localScale=Vector3.one*(.2f+progress*.85f);a.impact.transform.localRotation=Quaternion.Euler(0,-progress*180*.45f,0);SurvivorOpacity(a.impact,fade*.9f);
                for(int i=0;i<6;i++){float angle=i*Mathf.PI*2/6+(a.at%997)*.004f,distance=progress*(.3f+(i%3)*.12f);a.sparks[i].transform.position=new Vector3(a.to.x+Mathf.Cos(angle)*distance,.12f+Mathf.Sin(progress*Mathf.PI)*.22f,a.to.z-Mathf.Sin(angle)*distance);a.sparks[i].transform.localScale=Vector3.one*(.13f*fade);SurvivorOpacity(a.sparks[i],fade);}
            }
            if(survivorJoinLabel!=null)survivorJoinLabel.text=SurvivorActive?"途中参加エリア":"参加エリア · "+SurvivorJoinCount()+"人";
        }
        Vector2 SurvivorJoinCenter => new Vector2((float)SurvivorCatalog["constants"]["join"]["x"], (float)SurvivorCatalog["constants"]["join"]["z"]);
        float SurvivorJoinRadius => (float)SurvivorCatalog["constants"]["join"]["r"];
        int SurvivorJoinCount()
        {
            int count=Vector2.Distance(new Vector2(controller.transform.position.x,-controller.transform.position.z),SurvivorJoinCenter)<=SurvivorJoinRadius?1:0;
            foreach(var pair in avatars)if(pair.Key!=selfId&&Vector2.Distance(new Vector2(pair.Value.transform.position.x,-pair.Value.transform.position.z),SurvivorJoinCenter)<=SurvivorJoinRadius)count++;
            return count;
        }
        TextMesh SurvivorLabel(Transform parent, string text, Vector3 position, float height, string background)
        {
            var label=FloatingLabel(parent,text,position,height,background);
            var holder=label.transform.parent.gameObject;Destroy(holder.GetComponent<FaceCamera>());holder.AddComponent<SurvivorBillboard>();
            label.fontStyle=FontStyle.Bold;SizeSurvivorLabel(label,height,background,.92f);
            return label;
        }
        void SizeSurvivorLabel(TextMesh label, float height, string background, float opacity)
        {
            font.RequestCharactersInTexture(label.text,48,FontStyle.Bold);float advance=0;
            foreach(char c in label.text)if(font.GetCharacterInfo(c,out var info,48,FontStyle.Bold))advance+=info.advance;
            var plate=label.transform.parent.Find("Label background");
            if(plate!=null)
            {
                float originalWidth=plate.GetComponent<MeshFilter>().sharedMesh.bounds.size.x;
                plate.localScale=new Vector3(height*(advance+40)/68/Mathf.Max(.001f,originalWidth),1,1);
                SurvivorColor(plate.gameObject,background);SurvivorOpacity(plate.gameObject,opacity);
            }
        }
        void BuildSurvivorEnvironment()
        {
            var r=environment.transform; var join=SurvivorJoinCenter;
            FloorRing(r,"Survivor join fill",new Vector3(join.x,.018f,join.y),0,SurvivorJoinRadius,"#ce5c91",.17f,48);
            FloorRing(r,"Survivor join ring",new Vector3(join.x,.025f,join.y),SurvivorJoinRadius-.07f,SurvivorJoinRadius,"#ff9ac8",1,64);
            survivorJoinLabel=SurvivorLabel(r,"参加エリア",new Vector3(join.x,2.1f,join.y),.24f,"#5c1c44");
            Taper(r,"Night altar",new Vector3(join.x+2.8f,.42f,join.y),.42f,.5f,.84f,"#38213b",24);
            var crystal=SurvivorPoly(r,"Night crystal",new Vector3(join.x+2.8f,.9f,-join.y),.28f,"ico1","#ef6b9b");SurvivorGlow(crystal,"#b32e70",1.2f);
            SurvivorLabel(r,"夜の受付",new Vector3(join.x+2.8f,1.5f,join.y),.22f,"#5d1e44");
            SurvivorLabel(r,"宵闇サバイバーズ",new Vector3(0,2.2f,-8),.34f,"#301834");
        }
    }
}
