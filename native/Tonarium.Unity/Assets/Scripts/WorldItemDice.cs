using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        readonly Dictionary<string, JArray> privateDiceResults = new Dictionary<string, JArray>();

        void OpenDiceItem(string id) => OpenNativeItem(id);

        void RecordDiceChat(JObject message)
        {
            var dice = message?["dice"] as JObject;
            string id = (string)dice?["id"];
            if (string.IsNullOrEmpty(id) || !(dice?["results"] is JArray results)) return;
            privateDiceResults[id] = (JArray)results.DeepClone();
            if (privateDiceResults.Count > 128) privateDiceResults.Remove(privateDiceResults.Keys.First());
            foreach (var item in items.Values.ToArray())
                if ((string)item["kind"] == "dice" && (string)item["roll"]?["id"] == id && (string)item["roll"]?["by"] == selfId)
                    ApplyItem(item);
        }

        void BuildDice(Transform root, JObject item)
        {
            Cylinder(root, "Dice stand", new Vector3(0, .68f, 0), .52f, .04f, "#7a4e30");
            ItemCylinder(root, "Dice pedestal", new Vector3(0, .33f, 0), .07f, .16f, .66f, "#5a3826", 16);
            var bowl = new GameObject("Dice bowl"); bowl.transform.SetParent(root, false); bowl.transform.localPosition = Vector3.up * .7f;
            Vector2[] profile = { new Vector2(0, 0), new Vector2(.26f, 0), new Vector2(.38f, .05f), new Vector2(.45f, .13f), new Vector2(.47f, .19f), new Vector2(.45f, .2f), new Vector2(.43f, .14f), new Vector2(.36f, .07f), new Vector2(.25f, .035f), new Vector2(0, .035f) };
            var vertices = new List<Vector3>(); var triangles = new List<int>();
            for (int s = 0; s <= 48; s++) foreach (var p in profile) vertices.Add(new Vector3(Mathf.Sin(s * Mathf.PI * 2 / 48) * p.x, p.y, Mathf.Cos(s * Mathf.PI * 2 / 48) * p.x));
            for (int s = 0; s < 48; s++) for (int n = 0; n < profile.Length - 1; n++)
            {
                int a = s * profile.Length + n, b = a + profile.Length;
                triangles.AddRange(new[] { a, b, b + 1, a, b + 1, a + 1 });
            }
            var mesh = new Mesh { name = "Web dice bowl profile" }; mesh.SetVertices(vertices); mesh.SetTriangles(triangles, 0); mesh.RecalculateNormals(); mesh.RecalculateBounds();
            bowl.AddComponent<MeshFilter>().sharedMesh = mesh; bowl.AddComponent<MeshRenderer>().sharedMaterial = Material("#a06a42"); bowl.AddComponent<MeshCollider>().sharedMesh = mesh; root.GetComponent<ItemResources>().Meshes.Add(mesh);
            var roll = item["roll"] as JObject;
            if (roll == null) { ItemBadge(root, "サイコロ", new Vector3(0, 1.25f, 0), .1f); return; }
            int count = Math.Max(1, Math.Min(10, (int?)roll["count"] ?? 1)), sides = (int?)roll["sides"] ?? 6;
            var random = new ItemDiceRandom((string)roll["id"] ?? "");
            float offset = random.Next() * Mathf.PI * 2;
            var paths = new List<ItemDiceMotion.Path>(); var results = roll["results"] as JArray;
            // 秘密の出目は本人宛てチャットからだけ復元する。
            if (results == null && (string)roll["by"] == selfId) privateDiceResults.TryGetValue((string)roll["id"] ?? "", out results);
            string color = sides == 4 ? "#e0604c" : sides == 6 ? "#f3efe6" : sides == 8 ? "#4b7fd9" : sides == 10 ? "#3f9f66" : sides == 12 ? "#8f5cc9" : sides == 20 ? "#e2ad35" : "#33404f";
            for (int i = 0; i < count; i++)
            {
                float radius = count == 1 ? 0 : .06f + .19f * Mathf.Sqrt((i + .5f) / count), angle = offset + i * 2.39996f;
                var path = new ItemDiceMotion.Path { A0 = random.Next() * Mathf.PI * 2, Direction = random.Next() < .5f ? -1 : 1, X = Mathf.Sin(angle) * radius, Z = -Mathf.Cos(angle) * radius,
                    Axis = new Vector3(random.Next() - .5f, random.Next() - .5f, -(random.Next() - .5f)).normalized, Spin = 14 + random.Next() * 10, Yaw = random.Next() * Mathf.PI * 2, Hops = 3 + (int)(random.Next() * 3) };
                var die = new GameObject("d" + sides); die.transform.SetParent(bowl.transform, false); path.Die = die.transform;
                BuildDieMesh(die.transform, sides, color);
                var label = new GameObject("Dice result"); label.transform.SetParent(bowl.transform, false); path.Result = label;
                ItemBadge(label.transform, results != null && i < results.Count ? results[i].ToString() : "？", new Vector3(path.X, .175f, -path.Z), .07f, "#281a10");
                paths.Add(path);
            }
            var motion = bowl.AddComponent<ItemDiceMotion>(); motion.Paths = paths; motion.StartAt = (long?)roll["at"] ?? Now; motion.ServerOffset = (long)serverOffset;
            string by = (string)users.OfType<JObject>().FirstOrDefault(u => (string)u["id"] == (string)roll["by"])?["name"] ?? "参加者";
            string dice = count + "d" + sides;
            string summary = results == null ? by + " がシークレットで " + dice + " を振りました" : by + "：" + dice + " = " + results.Sum(v => (int)v) + ((bool?)roll["secret"] == true ? "（あなただけ）" : "");
            motion.SettledLabel = ItemBadge(root, summary, new Vector3(0, 1.25f, 0), .1f);
            motion.RollingLabel = ItemBadge(root, by + " が " + dice + " を振っています…", new Vector3(0, 1.25f, 0), .1f);
            motion.Refresh();
        }

        void BuildDieMesh(Transform root, int sides, string color)
        {
            if (sides == 6) { var box = Box(root, "Die", Vector3.zero, Vector3.one * .07f, color); Destroy(box.GetComponent<Collider>()); return; }
            if (sides == 10 || sides == 100)
            {
                var top = ItemCylinder(root, "Upper die", Vector3.up * .0175f, 0, .035f, .035f, color, 5); Destroy(top.GetComponent<Collider>());
                var bottom = ItemCylinder(root, "Lower die", Vector3.down * .0175f, .035f, 0, .035f, color, 5); Destroy(bottom.GetComponent<Collider>()); return;
            }
            Vector3[] vertices; int[] faces; float r = .07f * .62f;
            if (sides == 4)
            {
                vertices = new[] { new Vector3(1, 1, 1), new Vector3(-1, -1, 1), new Vector3(-1, 1, -1), new Vector3(1, -1, -1) };
                faces = new[] { 2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1 }; r *= 1.2f;
            }
            else if (sides == 8)
            {
                vertices = new[] { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
                faces = new[] { 0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2 }; r *= 1.05f;
            }
            else
            {
                float g = (1 + Mathf.Sqrt(5)) / 2;
                vertices = new[] { new Vector3(-1,g,0), new Vector3(1,g,0), new Vector3(-1,-g,0), new Vector3(1,-g,0), new Vector3(0,-1,g), new Vector3(0,1,g), new Vector3(0,-1,-g), new Vector3(0,1,-g), new Vector3(g,0,-1), new Vector3(g,0,1), new Vector3(-g,0,-1), new Vector3(-g,0,1) };
                faces = new[] {0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1};
                if (sides == 12) { BuildDodecahedron(root, vertices, faces, r, color); return; }
                r *= 1.05f;
            }
            var flat = faces.Select(i => vertices[i].normalized * r).ToArray(); var mesh = new Mesh { name = "Web d" + sides, vertices = flat, triangles = Enumerable.Range(0, flat.Length).ToArray() }; mesh.RecalculateNormals(); mesh.RecalculateBounds();
            root.gameObject.AddComponent<MeshFilter>().sharedMesh = mesh; root.gameObject.AddComponent<MeshRenderer>().sharedMaterial = Material(color); root.GetComponentInParent<ItemResources>().Meshes.Add(mesh);
        }

        void BuildDodecahedron(Transform root, Vector3[] ico, int[] faces, float radius, string color)
        {
            var centers = Enumerable.Range(0, 20).Select(i => (ico[faces[i * 3]] + ico[faces[i * 3 + 1]] + ico[faces[i * 3 + 2]]).normalized * radius).ToArray();
            var verts = new List<Vector3>();
            for (int i = 0; i < ico.Length; i++)
            {
                int vertex = i; var normal = ico[i].normalized; var tangent = Vector3.Cross(normal, Vector3.up).normalized;
                if (tangent.sqrMagnitude < .01f) tangent = Vector3.Cross(normal, Vector3.right).normalized;
                var other = Vector3.Cross(normal, tangent);
                var polygon = Enumerable.Range(0, 20).Where(n => faces[n * 3] == vertex || faces[n * 3 + 1] == vertex || faces[n * 3 + 2] == vertex).OrderBy(n => Mathf.Atan2(Vector3.Dot(centers[n], other), Vector3.Dot(centers[n], tangent))).ToArray();
                for (int j = 1; j < polygon.Length - 1; j++) { verts.Add(centers[polygon[0]]); verts.Add(centers[polygon[j]]); verts.Add(centers[polygon[j + 1]]); }
            }
            var mesh = new Mesh { name = "Web d12", vertices = verts.ToArray(), triangles = Enumerable.Range(0, verts.Count).ToArray() }; mesh.RecalculateNormals(); mesh.RecalculateBounds();
            root.gameObject.AddComponent<MeshFilter>().sharedMesh = mesh; root.gameObject.AddComponent<MeshRenderer>().sharedMaterial = Material(color); root.GetComponentInParent<ItemResources>().Meshes.Add(mesh);
        }
    }

    public sealed class ItemDiceRandom
    {
        uint state = 2166136261;
        public ItemDiceRandom(string seed) { foreach (char c in seed) state = unchecked((state ^ c) * 16777619); }
        public float Next()
        {
            state = unchecked(state + 0x6d2b79f5); uint t = unchecked((state ^ (state >> 15)) * (1 | state)); t = unchecked((t + ((t ^ (t >> 7)) * (61 | t))) ^ t); return (t ^ (t >> 14)) / 4294967296f;
        }
    }
    public sealed class ItemDiceMotion : MonoBehaviour
    {
        public sealed class Path { public Transform Die; public GameObject Result; public float A0, Direction, X, Z, Spin, Yaw; public int Hops; public Vector3 Axis; }
        public List<Path> Paths;
        public long StartAt, ServerOffset;
        public GameObject SettledLabel, RollingLabel;
        void Update() => Refresh();
        public void Refresh()
        {
            float p = Mathf.Clamp01((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ServerOffset - StartAt) / 1800f);
            if (SettledLabel != null) SettledLabel.SetActive(p >= 1);
            if (RollingLabel != null) RollingLabel.SetActive(p < 1);
            foreach (var d in Paths)
            {
                float a = d.A0 + d.Direction * 7 * (1 - (1 - p) * (1 - p)), radius = .32f - .08f * p, k = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(.45f, 1, p));
                d.Die.localPosition = new Vector3(Mathf.Lerp(Mathf.Sin(a) * radius, d.X, k), .07f + Mathf.Abs(Mathf.Sin(p * Mathf.PI * d.Hops)) * .14f * (1 - p) * (1 - p), Mathf.Lerp(-Mathf.Cos(a) * radius, d.Z, k));
                d.Die.localRotation = Quaternion.Slerp(Quaternion.AngleAxis(d.Spin * (1 - Mathf.Pow(1 - p, 3)) * Mathf.Rad2Deg, d.Axis), Quaternion.AngleAxis(-d.Yaw * Mathf.Rad2Deg, Vector3.up), Mathf.SmoothStep(0, 1, Mathf.InverseLerp(.75f, 1, p)));
                d.Result.SetActive(p >= 1);
            }
            if (p >= 1) enabled = false;
        }
    }
}
