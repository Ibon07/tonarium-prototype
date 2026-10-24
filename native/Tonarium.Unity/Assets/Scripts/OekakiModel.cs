using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class OekakiModel : MonoBehaviour
    {
        sealed class Channel
        {
            public int Node;
            public string Path;
            public float[] Times, Values;
        }

        static JObject data;
        static Mesh[] meshes;
        static Channel[] channels;
        static Texture2D sample;
        readonly Dictionary<string, Transform> parts = new Dictionary<string, Transform>();
        Transform[] nodes;
        Vector3[] positions, scales;
        Quaternion[] rotations;
        Material bodyMaterial, faceMaterial;
        Texture2D ownedTexture;
        JObject parameters = new JObject();
        float tilt, blink;
        public string EmoteId;
        public float EmoteStarted, EmoteDuration;
        public bool Speaking { get; set; }
        public float LookPitch { get; set; }

        public static GameObject Create(Transform parent)
        {
            if (data == null)
            {
                data = JObject.Parse(Resources.Load<TextAsset>("OekakiGeometry").text);
                sample = Resources.Load<Texture2D>("OekakiSample");
                var source = (JArray)data["meshes"]; meshes = new Mesh[source.Count];
                for (int i = 0; i < source.Count; i++) meshes[i] = ReadMesh((JObject)source[i]);
                var list = new List<Channel>();
                foreach (var animation in (JArray)data["animations"])
                    foreach (var c in (JArray)animation["channels"])
                        list.Add(new Channel { Node = (int)c["node"], Path = (string)c["path"], Times = c["times"].ToObject<float[]>(), Values = c["values"].ToObject<float[]>() });
                channels = list.ToArray();
            }
            var root = new GameObject("Oekaki avatar"); root.transform.SetParent(parent, false);
            root.transform.localScale = Vector3.one * .012f;
            root.transform.localRotation = Quaternion.Euler(0, 180, 0);
            var model = root.AddComponent<OekakiModel>();
            int count = ((JArray)data["nodes"]).Count;
            model.nodes = new Transform[count]; model.positions = new Vector3[count];
            model.scales = new Vector3[count]; model.rotations = new Quaternion[count];
            model.bodyMaterial = NewMaterial(sample); model.faceMaterial = NewMaterial(sample);
            foreach (var node in (JArray)data["scenes"][0]["nodes"]) model.Node((int)node, root.transform);
            model.Pose(Time.time);
            return root;
        }

        static Material NewMaterial(Texture texture)
        {
            var material = new Material(Shader.Find("Unlit/Transparent Cutout")) { mainTexture = texture, color = Color.white };
            material.SetFloat("_Cutoff", .5f);
            return material;
        }

        void Node(int index, Transform parent)
        {
            var node = data["nodes"][index];
            var o = new GameObject((string)node["name"]); o.transform.SetParent(parent, false);
            positions[index] = node["translation"] is JArray t ? Vector(t.ToObject<float[]>(), 0, true) : Vector3.zero;
            rotations[index] = node["rotation"] is JArray r ? Rotation(r.ToObject<float[]>(), 0) : Quaternion.identity;
            scales[index] = node["scale"] is JArray s ? Vector(s.ToObject<float[]>(), 0, false) : Vector3.one;
            nodes[index] = o.transform; parts[o.name] = o.transform;
            if (node["mesh"] != null)
            {
                o.AddComponent<MeshFilter>().sharedMesh = meshes[(int)node["mesh"]];
                o.AddComponent<MeshRenderer>().sharedMaterial = o.name == "Head_Front" ? faceMaterial : bodyMaterial;
            }
            if (node["children"] is JArray children) foreach (var child in children) Node((int)child, o.transform);
        }

        static Mesh ReadMesh(JObject source)
        {
            var p = (JArray)source["POSITION"]; var uv = (JArray)source["TEXCOORD_0"]; var n = (JArray)source["NORMAL"]; var faces = (JArray)source["indices"];
            var vertices = new Vector3[p.Count / 3]; var normals = new Vector3[vertices.Length]; var coords = new Vector2[vertices.Length];
            for (int i = 0; i < vertices.Length; i++)
            {
                vertices[i] = new Vector3((float)p[i * 3], (float)p[i * 3 + 1], -(float)p[i * 3 + 2]);
                normals[i] = new Vector3((float)n[i * 3], (float)n[i * 3 + 1], -(float)n[i * 3 + 2]);
                coords[i] = new Vector2((float)uv[i * 2], 1 - (float)uv[i * 2 + 1]);
            }
            var indices = new int[faces.Count];
            for (int i = 0; i < indices.Length; i += 3) { indices[i] = (int)faces[i]; indices[i + 1] = (int)faces[i + 2]; indices[i + 2] = (int)faces[i + 1]; }
            var mesh = new Mesh { vertices = vertices, normals = normals, uv = coords, triangles = indices }; mesh.RecalculateBounds(); return mesh;
        }

        void Update()
        {
            Pose(Time.time);
            ApplyEmotePose();
            if (blink > 0) blink -= Time.deltaTime;
            else if (UnityEngine.Random.value < 1 - Mathf.Pow(.996f, Time.deltaTime * 60)) blink = .15f;
            faceMaterial.mainTextureOffset = new Vector2(Speaking && Mathf.Sin(Time.time / .09f) > 0 ? -1f / 6 : blink > 0 ? 1f / 6 : 0, 0);
        }

        void Pose(float seconds)
        {
            if (nodes == null) return;
            for (int i = 0; i < nodes.Length; i++)
            {
                nodes[i].localPosition = positions[i]; nodes[i].localRotation = rotations[i]; nodes[i].localScale = scales[i];
            }
            foreach (var c in channels)
            {
                if (c.Times.Length == 0) continue;
                float duration = c.Times[c.Times.Length - 1]; float t = duration > 0 ? seconds % duration : 0;
                int a = Array.BinarySearch(c.Times, t); if (a < 0) a = Mathf.Max(0, ~a - 1);
                int b = Mathf.Min(a + 1, c.Times.Length - 1);
                float dt = c.Times[b] - c.Times[a], blend = dt > 0 ? (t - c.Times[a]) / dt : 0;
                if (c.Path == "rotation") nodes[c.Node].localRotation = Quaternion.Slerp(Rotation(c.Values, a * 4), Rotation(c.Values, b * 4), blend);
                else if (c.Path == "translation") nodes[c.Node].localPosition = Vector3.Lerp(Vector(c.Values, a * 3, true), Vector(c.Values, b * 3, true), blend);
                else if (c.Path == "scale") nodes[c.Node].localScale = Vector3.Lerp(Vector(c.Values, a * 3, false), Vector(c.Values, b * 3, false), blend);
            }
            AddScale("Head_Front", "headSize"); AddScale("Head_Back", "headSize");
            AddScale("Body_Front", "bodySize"); AddScale("Body_Back", "bodySize");
            AddScale("LeftHand", "handSize"); AddScale("RightHand", "handSize");
            AddScale("Tail", "tailSize"); AddScale("Feet", "legsSize");
            Offset("Body", new Vector3(0, -Number("neckLength"), Flag("headInFront") ? .5f : -.5f));
            Offset("Tail", new Vector3(0, -Number("tailPosition"), 0));
            Offset("Feet", new Vector3(0, -Number("legsDistanceFromBody"), Flag("legsInFront") ? -.5f : .5f));
            Offset("LeftFoot", new Vector3(Number("legsDistance"), 0, 0));
            Offset("RightFoot", new Vector3(-Number("legsDistance"), 0, -.001f));
            if (parts.TryGetValue("Tail", out var tail))
            {
                tail.gameObject.SetActive(!Flag("disableTail", false));
                tail.localRotation *= Quaternion.Euler(0, 0, Number("tailRotation") * Mathf.Rad2Deg);
            }
            tilt = Mathf.Lerp(tilt, LookPitch, Mathf.Min(1, Time.deltaTime * 10));
            var q = Quaternion.AngleAxis(Mathf.Clamp(tilt * .8f, -.7f, .7f) * Mathf.Rad2Deg, Vector3.right);
            foreach (string name in new[] { "Head_Front", "Head_Back" }) if (parts.TryGetValue(name, out var face)) face.localRotation = q * face.localRotation;
        }

        // shared/emotes.ts: visual offsets only; never alters the player collider or camera.
        void ApplyEmotePose()
        {
            float elapsed=(Time.unscaledTime-EmoteStarted)*1000;
            float weight=Smooth(elapsed/220)*Smooth((EmoteDuration-elapsed)/350),t=Mathf.Max(0,elapsed)/1000;
            float y=0,rx=0,rz=0,sx=1,sy=1,left=0,right=0,bow=0,liftLeft=0,liftRight=0;
            if(weight>0 && EmoteId=="wave"){right=(-.25f+Mathf.Sin(t*17)*.55f)*weight;liftRight=38*weight;rz=Mathf.Sin(t*6)*.06f*weight;}
            else if(weight>0 && EmoteId=="hop"){float bounce=Mathf.Abs(Mathf.Sin(t*Mathf.PI*3));y=bounce*.38f*weight;sx=1+(.08f-bounce*.12f)*weight;sy=1+(bounce*.16f-.1f)*weight;left=-.4f*weight;right=.4f*weight;liftLeft=liftRight=28*weight;}
            else if(weight>0 && EmoteId=="slump"){y=-.13f*weight;rx=-.2f*weight;sy=1-.16f*weight;left=.22f*weight;right=-.22f*weight;bow=.48f*weight;liftLeft=liftRight=-10*weight;}
            else if(weight>0 && EmoteId=="fall"){float collapse=Smooth((elapsed-150)/500)*Smooth((EmoteDuration-elapsed)/500);rz=-Mathf.PI/2*collapse;y=.12f*collapse;left=-.7f*collapse;right=.8f*collapse;}
            transform.localPosition=new Vector3(0,y,0);
            transform.localRotation=Quaternion.Euler(-rx*Mathf.Rad2Deg,180,rz*Mathf.Rad2Deg);
            transform.localScale=new Vector3(sx,sy,1)*.012f;
            Offset("LeftHand",new Vector3(0,liftLeft,0));Offset("RightHand",new Vector3(0,liftRight,0));
            if(parts.TryGetValue("LeftHand",out var lh))lh.localRotation*=Quaternion.Euler(0,0,left*Mathf.Rad2Deg);
            if(parts.TryGetValue("RightHand",out var rh))rh.localRotation*=Quaternion.Euler(0,0,right*Mathf.Rad2Deg);
            foreach(string name in new[]{"Head_Front","Head_Back"})if(parts.TryGetValue(name,out var face))face.localRotation=Quaternion.Euler(-bow*Mathf.Rad2Deg,0,0)*face.localRotation;
        }
        static float Smooth(float value){value=Mathf.Clamp01(value);return value*value*(3-2*value);}

        static Vector3 Vector(float[] v, int offset, bool reflect) => new Vector3(v[offset], v[offset + 1], v[offset + 2] * (reflect ? -1 : 1));
        static Quaternion Rotation(float[] v, int offset) => new Quaternion(-v[offset], -v[offset + 1], v[offset + 2], v[offset + 3]);
        float Number(string key) => parameters[key] != null && (parameters[key].Type == JTokenType.Float || parameters[key].Type == JTokenType.Integer) ? Mathf.Clamp((float)parameters[key], -100, 100) : 0;
        bool Flag(string key, bool fallback = true) => parameters[key]?.Type == JTokenType.Boolean ? (bool)parameters[key] : fallback;
        void AddScale(string name, string key) { if (parts.TryGetValue(name, out var t)) t.localScale += Vector3.one * Number(key); }
        void Offset(string name, Vector3 delta) { if (parts.TryGetValue(name, out var t)) t.localPosition += delta; }
        public void ApplyParameters(JObject p) { parameters = p ?? new JObject(); Pose(Time.time); }
        public void ApplyTexture(Texture2D texture)
        {
            if (ownedTexture != null && ownedTexture != texture) Destroy(ownedTexture);
            ownedTexture = texture; texture.wrapMode = TextureWrapMode.Repeat; texture.filterMode = FilterMode.Bilinear;
            bodyMaterial.mainTexture = faceMaterial.mainTexture = texture;
        }
        void OnDestroy()
        {
            if (bodyMaterial != null) Destroy(bodyMaterial);
            if (faceMaterial != null) Destroy(faceMaterial);
            if (ownedTexture != null) Destroy(ownedTexture);
        }
    }
}
