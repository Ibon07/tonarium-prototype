using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class OekakiModel : MonoBehaviour
    {
        static JObject data;
        static Mesh[] meshes;
        static Texture2D sample;
        readonly Dictionary<string, Transform> parts = new Dictionary<string, Transform>();
        readonly Dictionary<string, Quaternion> rest = new Dictionary<string, Quaternion>();
        Vector3 lastPosition;
        float movement;

        public static GameObject Create(Transform parent)
        {
            if (data == null)
            {
                data = JObject.Parse(Resources.Load<TextAsset>("OekakiGeometry").text);
                sample = Resources.Load<Texture2D>("OekakiSample");
                var source = (JArray)data["meshes"]; meshes = new Mesh[source.Count];
                for (int i = 0; i < source.Count; i++) meshes[i] = ReadMesh((JObject)source[i]);
            }
            var root = new GameObject("Oekaki avatar"); root.transform.SetParent(parent, false); root.transform.localScale = Vector3.one * .012f;
            var model = root.AddComponent<OekakiModel>();
            foreach (var node in (JArray)data["scenes"][0]["nodes"]) model.Node((int)node, root.transform);
            model.lastPosition = parent.position;
            return root;
        }

        void Node(int index, Transform parent)
        {
            var node = data["nodes"][index];
            var o = new GameObject((string)node["name"]); o.transform.SetParent(parent, false);
            if (node["translation"] is JArray t) o.transform.localPosition = new Vector3((float)t[0], (float)t[1], -(float)t[2]);
            if (node["rotation"] is JArray r) o.transform.localRotation = new Quaternion(-(float)r[0], -(float)r[1], (float)r[2], (float)r[3]);
            if (node["scale"] is JArray s) o.transform.localScale = new Vector3((float)s[0], (float)s[1], (float)s[2]);
            if (node["mesh"] != null)
            {
                o.AddComponent<MeshFilter>().sharedMesh = meshes[(int)node["mesh"]];
                var renderer = o.AddComponent<MeshRenderer>();
                renderer.material = new Material(Shader.Find("Unlit/Transparent Cutout")) { mainTexture = sample, color = Color.white };
                renderer.material.SetFloat("_Cutoff", .5f);
            }
            parts[o.name] = o.transform; rest[o.name] = o.transform.localRotation;
            if (node["children"] is JArray children) foreach (var child in children) Node((int)child, o.transform);
        }

        static Mesh ReadMesh(JObject source)
        {
            var p = (JArray)source["POSITION"]; var uv = (JArray)source["TEXCOORD_0"]; var n = (JArray)source["NORMAL"]; var faces = (JArray)source["indices"];
            var vertices = new Vector3[p.Count / 3]; var normals = new Vector3[vertices.Length]; var coords = new Vector2[vertices.Length];
            for (int i = 0; i < vertices.Length; i++)
            {
                vertices[i] = new Vector3((float)p[i*3], (float)p[i*3+1], -(float)p[i*3+2]);
                normals[i] = new Vector3((float)n[i*3], (float)n[i*3+1], -(float)n[i*3+2]);
                coords[i] = new Vector2((float)uv[i*2], 1-(float)uv[i*2+1]);
            }
            var indices = new int[faces.Count];
            for (int i=0;i<indices.Length;i+=3) { indices[i]=(int)faces[i]; indices[i+1]=(int)faces[i+2]; indices[i+2]=(int)faces[i+1]; }
            var mesh = new Mesh { vertices = vertices, normals = normals, uv = coords, triangles = indices }; mesh.RecalculateBounds(); return mesh;
        }

        void Update()
        {
            float speed = (transform.parent.position - lastPosition).magnitude / Mathf.Max(Time.deltaTime, .001f);
            lastPosition = transform.parent.position;
            movement = Mathf.Lerp(movement, Mathf.Min(speed, 4), Time.deltaTime * 8);
            float walk = Mathf.Sin(Time.time * 9) * movement * 4;
            Animate("LeftFoot", walk); Animate("RightFoot", -walk);
            Animate("LeftHand", -walk * .5f + Mathf.Sin(Time.time * 2) * 2);
            Animate("RightHand", walk * .5f - Mathf.Sin(Time.time * 2) * 2);
            Animate("Tail", Mathf.Sin(Time.time * 2.5f) * 7);
        }
        void Animate(string name, float degrees) { if (parts.TryGetValue(name, out var t)) t.localRotation = rest[name] * Quaternion.Euler(degrees, 0, 0); }

        public void ApplyParameters(JObject p)
        {
            AddScale("Head_Front", p, "headSize"); AddScale("Head_Back", p, "headSize");
            AddScale("Body_Front", p, "bodySize"); AddScale("Body_Back", p, "bodySize");
            AddScale("LeftHand", p, "handSize"); AddScale("RightHand", p, "handSize");
            AddScale("Tail", p, "tailSize"); AddScale("Feet", p, "legsSize");
            Offset("Body", new Vector3(0, -(float?)p["neckLength"] ?? 0, 0));
            Offset("Tail", new Vector3(0, -(float?)p["tailPosition"] ?? 0, 0));
            Offset("Feet", new Vector3(0, -(float?)p["legsDistanceFromBody"] ?? 0, 0));
            Offset("LeftFoot", new Vector3((float?)p["legsDistance"] ?? 0, 0, 0));
            Offset("RightFoot", new Vector3(-((float?)p["legsDistance"] ?? 0), 0, 0));
            if (parts.TryGetValue("Tail", out var tail)) tail.gameObject.SetActive((bool?)p["disableTail"] != true);
        }
        void AddScale(string name, JObject p, string key) { if (parts.TryGetValue(name, out var t)) t.localScale += Vector3.one * ((float?)p[key] ?? 0); }
        void Offset(string name, Vector3 delta) { if (parts.TryGetValue(name, out var t)) t.localPosition += delta; }
    }
}
