using Newtonsoft.Json.Linq;
using UnityEngine;
namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        static JObject worldCatalog;
        static JObject WorldCatalog => worldCatalog ?? (worldCatalog = JObject.Parse(Resources.Load<TextAsset>("Web/WorldCatalog").text));
        void BuildGarden()
        {
            var r = environment.transform;
            var garden = WorldCatalog["garden"];
            eye.backgroundColor = ColorValue("#c8e3ed");
            RenderSettings.ambientSkyColor = ColorValue("#e4f2ff");
            RenderSettings.ambientGroundColor = ColorValue("#698555");
            Box(r,"Garden floor",new Vector3(0,-.1f,0),new Vector3(20,.2f,20),"#91ad70");
            // The same dimensions as Web/shared/worlds.ts; visual foliage has no collision.
            foreach(JObject p in garden["paths"]) FlatSurface(r,"Garden path",new Vector3(Float(p,"x"),.003f,Float(p,"z")),Float(p,"w"),Float(p,"d"),"#d6cfb6",true);
            foreach(JObject p in garden["trees"])
            {
                float x=Float(p,"x"),z=Float(p,"z"),h=Float(p,"h"),c=Float(p,"canopy");
                Cylinder(r,"Tree trunk",new Vector3(x,h/2,z),Float(p,"r"),h,"#74523b");
                var crown=Icosahedron(r,"Tree canopy",new Vector3(x,h+c*.6f,z),c,(string)p["color"]); crown.transform.localScale=new Vector3(1,.85f,1); RemoveGardenColliders(crown);
                RemoveGardenColliders(Icosahedron(r,"Tree crown",new Vector3(x+c*.22f,h+c*1.1f,z-c*.1f),c*.65f,(string)p["color"]));
            }
            foreach(JObject p in garden["benches"])
            {
                float w=Float(p,"w"),d=Float(p,"d"),f=Float(p,"facing");
                var bench=new GameObject("Garden bench");bench.transform.SetParent(r,false);bench.transform.localPosition=ToUnity(new Vector3(Float(p,"x"),0,Float(p,"z")));bench.transform.localRotation=Quaternion.Euler(0,f==1?0:180,0);
                for(int side=-1;side<=1;side+=2){Box(bench.transform,"Leg",new Vector3(side*(w/2-.2f),.24f,0),new Vector3(.12f,.48f,d*.8f),"#384d43");Box(bench.transform,"Back support",new Vector3(side*(w/2-.2f),.72f,-d/2+.07f),new Vector3(.1f,.65f,.1f),"#384d43");}
                for(int slat=-1;slat<=1;slat++)Box(bench.transform,"Seat",new Vector3(0,.52f,slat*d/3),new Vector3(w,.14f,d/3-.02f),"#b88752");
                foreach(float y in new[]{.82f,1.06f})Box(bench.transform,"Back",new Vector3(0,y,-d/2+.07f),new Vector3(w,.2f,.12f),"#bd905c");
                // Web treats the complete footprint as solid, rather than individual slats.
                foreach(var c in bench.GetComponentsInChildren<Collider>())Destroy(c);
                var collider=bench.AddComponent<BoxCollider>();collider.center=new Vector3(0,.55f,0);collider.size=new Vector3(w,1.1f,d);
            }
            foreach(JObject p in garden["beds"])
            {
                float x=Float(p,"x"),z=Float(p,"z"),w=Float(p,"w"),d=Float(p,"d");
                Box(r,"Flower bed",new Vector3(x,.21f,z),new Vector3(w,.42f,d),"#ddd6c2");
                Box(r,"Soil",new Vector3(x,.421f,z),new Vector3(w-.18f,.025f,d-.18f),"#65533e");
                for(int side=-1;side<=1;side+=2)for(int row=-1;row<=1;row++)
                {
                    var v=new Vector3(x+side*w*.22f,.44f,z+row*d*.3f);
                    RemoveGardenColliders(Cylinder(r,"Flower stem",v+Vector3.up*.12f,.018f,.24f,"#4d7545"));
                    RemoveGardenColliders(Sphere(r,"Flower leaf",v+new Vector3(.045f,.1f,0),new Vector3(.17f,.0595f,.102f),"#67935a"));
                    RemoveGardenColliders(Icosahedron(r,"Flower",v+Vector3.up*.25f,.115f,(string)p["color"]));
                    RemoveGardenColliders(Sphere(r,"Flower center",v+Vector3.up*.34f,Vector3.one*.086f,"#f4d379"));
                }
            }
            foreach(JObject p in garden["lamps"])
            {
                float x=Float(p,"x"),z=Float(p,"z"),h=Float(p,"h"),radius=Float(p,"r");
                Cylinder(r,"Lamp base",new Vector3(x,.08f,z),radius,.16f,"#475b4f");
                Cylinder(r,"Lamp post",new Vector3(x,h/2,z),radius*.3f,h,"#475b4f");
                Cylinder(r,"Lamp bottom",new Vector3(x,h-.28f,z),radius*.9f,.06f,"#384d43");
                RemoveGardenColliders(Cylinder(r,"Lamp glass",new Vector3(x,h-.12f,z),radius*.65f,.26f,"#fff0ca"));
                Taper(r,"Lamp top",new Vector3(x,h+.04f,z),radius,radius*1.2f,.08f,"#384d43",12);
            }
            FloorArea(r,"Spawn",new Vector3(0,0,6.5f),1.6f,.06f,"#f5db91",.16f,.8f);
            // World movement remains bounded to the Web garden's 20 x 20 area.
            foreach(var p in new[]{new Vector3(0,2,10),new Vector3(0,2,-10),new Vector3(10,2,0),new Vector3(-10,2,0)})
            { var wall=Box(r,"Garden boundary",p,p.x==0?new Vector3(20,4,.2f):new Vector3(.2f,4,20),"#91ad70");wall.GetComponent<Renderer>().material.color=ColorValue("#d6dbc5"); }
        }
        static void RemoveGardenColliders(GameObject target){foreach(var collider in target.GetComponentsInChildren<Collider>())Destroy(collider);}
    }
}
