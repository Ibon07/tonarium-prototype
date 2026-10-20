using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        readonly Dictionary<string, AvatarPresentation> avatarPresentations = new Dictionary<string, AvatarPresentation>();
        readonly Dictionary<string, KeyValuePair<string, float>> avatarSpeech = new Dictionary<string, KeyValuePair<string, float>>();

        public void RecordAvatarChat(JObject message)
        {
            string id = (string)message?["from"], text = (string)message?["text"];
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(text)) return;
            long at = (long?)message["at"] ?? Now;
            float remaining = 30 - Mathf.Max(0, (Now - at) / 1000f);
            if (remaining <= 0) return;
            text = string.Join(" ", text.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
            avatarSpeech[id] = new KeyValuePair<string, float>(text.Length > 32 ? text.Substring(0, 31) + "…" : text, Time.time + remaining);
        }

        public void UpdateAvatarPresentation()
        {
            var places = new Dictionary<string, JObject>();
            foreach (var user in users.OfType<JObject>())
            {
                string id = (string)user["id"];
                if (id == null || (string)user["session"] != sessionId || (string)user["mode"] != "3d") continue;
                if (id == selfId)
                {
                    var pos = controller.transform.position;
                    places[id] = new JObject { ["x"] = pos.x, ["z"] = -pos.z, ["ry"] = -yaw * Mathf.Deg2Rad };
                }
                else if (avatarStates.TryGetValue(id, out var state)) places[id] = state;
            }
            int queue = 0;
            var followers = new Dictionary<string, int>();
            foreach (var user in users.OfType<JObject>())
            {
                string id = (string)user["id"];
                if (id == null || (string)user["session"] != sessionId) continue;
                bool standee = (string)user["mode"] == "2d", small = false;
                if (standee)
                {
                    string follow = (string)user["follow"] ?? (string)presence[id]?["follow"];
                    JObject position;
                    bool carried = carrying == "user:" + id;
                    if (carried)
                    {
                        var p = controller.transform.position + controller.transform.forward * 2;
                        position = new JObject { ["x"] = p.x, ["z"] = -p.z, ["ry"] = -yaw * Mathf.Deg2Rad + Mathf.PI };
                    }
                    else if (follow != null && places.TryGetValue(follow, out var target))
                    {
                        followers.TryGetValue(follow, out int i); followers[follow] = i + 1;
                        float side = (i % 2 == 1 ? -1 : 1) * Mathf.Ceil(i / 2f) * .45f, back = .9f + Mathf.Floor(i / 3f) * .35f;
                        float angle = Float(target, "ry");
                        position = new JObject { ["x"] = Float(target, "x") + Mathf.Sin(angle) * back + Mathf.Cos(angle) * side,
                            ["z"] = Float(target, "z") + Mathf.Cos(angle) * back - Mathf.Sin(angle) * side, ["ry"] = angle };
                        small = true;
                    }
                    else if ((user["pos"] ?? presence[id]?["pos"]) is JObject fixedPosition) position = fixedPosition;
                    else
                    {
                        float radius = .45f * Mathf.Sqrt(queue), angle = queue++ * 2.39996f;
                        position = new JObject { ["x"] = Mathf.Sin(angle) * radius, ["z"] = 6.5f + Mathf.Cos(angle) * radius, ["ry"] = 0 };
                    }
                    places[id] = position;
                    if (avatars.TryGetValue(id, out var body))
                    {
                        float factor = carried ? 1 : Mathf.Min(1, Time.deltaTime * 8);
                        body.transform.position = Vector3.Lerp(body.transform.position, Position(position), factor);
                        body.transform.rotation = Quaternion.Slerp(body.transform.rotation, Quaternion.Euler(0, -Float(position, "ry") * Mathf.Rad2Deg, 0), factor);
                    }
                }
                if (id == selfId || !avatars.TryGetValue(id, out var root)) continue;
                if (!avatarPresentations.TryGetValue(id, out var presentation) || presentation == null)
                {
                    foreach (var old in root.GetComponentsInChildren<TextMesh>()) Destroy(old.gameObject);
                    presentation = root.AddComponent<AvatarPresentation>();
                    presentation.Initialize(font); avatarPresentations[id] = presentation;
                }
                float scale = small ? .45f : 1;
                root.transform.localScale = Vector3.Lerp(root.transform.localScale, Vector3.one * scale, Mathf.Min(1, Time.deltaTime * 8));
                string name = (string)user["name"] ?? id, version = (string)user["avatar"];
                if (presentation.AvatarName != name || presentation.Version != version)
                {
                    bool initial = presentation.AvatarName == null;
                    presentation.AvatarName = name; presentation.Version = version;
                    if (!initial)
                    {
                        presentation.Model.ApplyParameters(new JObject());
                        StartCoroutine(LoadAvatar(presentation.Model.gameObject, name, version));
                    }
                }
                bool speaking = (bool?)user["speaking"] == true;
                string muted = user["micOn"]?.Type == JTokenType.Boolean && !(bool)user["micOn"] ? "🔇 " : "";
                presentation.SetIdentity((standee ? "2D " : "") + muted + name, standee, speaking);
                presentation.Model.LookPitch = !standee && avatarStates.TryGetValue(id, out var avatar) ? Float(avatar, "pitch") : 0;
                presentation.Model.Speaking = speaking;
                presentation.SetSpeech(avatarSpeech.TryGetValue(id, out var speech) && speech.Value > Time.time ? speech.Key : null);
            }
            foreach (string id in avatarPresentations.Keys.ToArray()) if (!avatars.ContainsKey(id)) avatarPresentations.Remove(id);
        }
    }

    public sealed class AvatarPresentation : MonoBehaviour
    {
        public string AvatarName, Version;
        public OekakiModel Model { get; private set; }
        WorldPill nameLabel, speechLabel;
        GameObject ring;
        bool wasStandee;

        public void Initialize(Font font)
        {
            Model = GetComponentInChildren<OekakiModel>();
            nameLabel = WorldPill.Create(transform, font, new Vector3(0, 1.3f, 0), .2f);
            speechLabel = WorldPill.Create(transform, font, new Vector3(0, 1.62f, 0), .2f);
            ring = new GameObject("Speaking ring"); ring.transform.SetParent(transform, false);
            ring.transform.localPosition = Vector3.up * .02f;
            ring.AddComponent<MeshFilter>().sharedMesh = Ring(.45f, .62f);
            ring.AddComponent<MeshRenderer>().sharedMaterial = new Material(Shader.Find("Sprites/Default")) { color = new Color(.133f, .773f, .369f, 1) };
        }

        public void SetIdentity(string text, bool standee, bool speaking)
        {
            var background = speaking ? new Color(.137f, .647f, .353f, .95f) : standee ? new Color(.306f, .314f, .345f, .9f) : new Color(0, 0, 0, .75f);
            nameLabel.Set(text, background, Color.white);
            ring.SetActive(speaking);
            if (wasStandee != standee)
            {
                var filter = ring.GetComponent<MeshFilter>(); Destroy(filter.sharedMesh); filter.sharedMesh = standee ? Ring(.32f, .42f) : Ring(.45f, .62f);
                ring.transform.localPosition = Vector3.up * (standee ? .05f : .02f); wasStandee = standee;
            }
        }

        public void SetSpeech(string text)
        {
            speechLabel.gameObject.SetActive(!string.IsNullOrEmpty(text));
            if (!string.IsNullOrEmpty(text)) speechLabel.Set(text, new Color(1, .992f, .976f, .96f), new Color(.149f, .149f, .18f));
        }

        static Mesh Ring(float inner, float outer)
        {
            const int segments = 32;
            var v = new Vector3[(segments + 1) * 2]; var triangles = new int[segments * 6];
            for (int i = 0; i <= segments; i++)
            {
                float a = i * Mathf.PI * 2 / segments;
                v[i * 2] = new Vector3(Mathf.Sin(a) * inner, 0, Mathf.Cos(a) * inner);
                v[i * 2 + 1] = new Vector3(Mathf.Sin(a) * outer, 0, Mathf.Cos(a) * outer);
                if (i == segments) continue;
                int j = i * 6; triangles[j] = i * 2; triangles[j + 1] = i * 2 + 2; triangles[j + 2] = i * 2 + 1;
                triangles[j + 3] = i * 2 + 1; triangles[j + 4] = i * 2 + 2; triangles[j + 5] = i * 2 + 3;
            }
            var mesh = new Mesh { vertices = v, triangles = triangles }; mesh.RecalculateBounds(); return mesh;
        }

        void OnDestroy()
        {
            if (ring == null) return;
            Destroy(ring.GetComponent<MeshFilter>().sharedMesh); Destroy(ring.GetComponent<MeshRenderer>().sharedMaterial);
        }
    }

    public sealed class WorldPill : MonoBehaviour
    {
        TextMesh text;
        MeshRenderer textRenderer, background;
        MeshFilter backgroundMesh;
        float height;
        bool layout;
        Color foreground;

        public static WorldPill Create(Transform parent, Font font, Vector3 position, float height)
        {
            var root = new GameObject("World label"); root.transform.SetParent(parent, false); root.transform.localPosition = position;
            var label = root.AddComponent<WorldPill>(); label.height = height;
            var ink = new GameObject("Text"); ink.transform.SetParent(root.transform, false);
            label.text = ink.AddComponent<TextMesh>(); label.text.font = font; label.text.fontSize = 64; label.text.characterSize = 1; label.text.fontStyle = FontStyle.Bold;
            label.text.anchor = TextAnchor.MiddleCenter; label.text.alignment = TextAlignment.Center;
            label.textRenderer = ink.GetComponent<MeshRenderer>(); label.textRenderer.sharedMaterial = new Material(font.material);
            label.textRenderer.sharedMaterial.renderQueue = 3010;
            var plate = new GameObject("Pill"); plate.transform.SetParent(root.transform, false); plate.transform.localPosition = Vector3.forward * .004f;
            label.backgroundMesh = plate.AddComponent<MeshFilter>(); label.background = plate.AddComponent<MeshRenderer>();
            label.background.sharedMaterial = new Material(Shader.Find("Sprites/Default")); label.background.sharedMaterial.renderQueue = 3009;
            Font.textureRebuilt += label.FontRebuilt;
            return label;
        }

        public void Set(string value, Color bg, Color fg)
        {
            if (text.text != value) { text.text = value; text.font.RequestCharactersInTexture(value, 64, FontStyle.Bold); layout = true; }
            background.sharedMaterial.color = bg; foreground = fg; text.color = fg;
        }

        void FontRebuilt(Font font)
        {
            if (font == text.font) { textRenderer.sharedMaterial.mainTexture = font.material.mainTexture; layout = true; }
        }

        void LateUpdate()
        {
            if (Camera.main != null) transform.rotation = Camera.main.transform.rotation;
            else if (Camera.allCameras.Length > 0) transform.rotation = Camera.allCameras[0].transform.rotation;
            if (!layout) return;
            var bounds = textRenderer.localBounds;
            if (bounds.size.y <= 0) return;
            int minY = int.MaxValue, maxY = int.MinValue;
            foreach (char c in text.text)
                if (text.font.GetCharacterInfo(c, out var glyph, 64, FontStyle.Bold) && glyph.glyphHeight > 0)
                { minY = Math.Min(minY, glyph.minY); maxY = Math.Max(maxY, glyph.maxY); }
            float emHeight = maxY > minY ? bounds.size.y * 64 / (maxY - minY) : bounds.size.y;
            float scale = height * (48f / 68) / emHeight;
            text.transform.localScale = Vector3.one * scale;
            text.transform.localPosition = -bounds.center * scale - Vector3.up * (height * 2 / 68);
            float width = Mathf.Max(height, bounds.size.x * scale + height * (40f / 68));
            if (backgroundMesh.sharedMesh != null) Destroy(backgroundMesh.sharedMesh);
            backgroundMesh.sharedMesh = Pill(width, height);
            text.color = foreground; layout = false;
        }

        static Mesh Pill(float width, float height)
        {
            const int half = 16;
            var points = new List<Vector3> { Vector3.zero }; float radius = height / 2, center = Mathf.Max(0, width / 2 - radius);
            for (int side = 0; side < 2; side++)
                for (int i = 0; i <= half; i++)
                {
                    float angle = (-Mathf.PI / 2 + Mathf.PI * i / half) + side * Mathf.PI;
                    points.Add(new Vector3(Mathf.Cos(angle) * radius + (side == 0 ? center : -center), Mathf.Sin(angle) * radius, 0));
                }
            var indices = new int[(points.Count - 1) * 3];
            for (int i = 1; i < points.Count; i++) { int n = (i - 1) * 3; indices[n] = 0; indices[n + 1] = i; indices[n + 2] = i == points.Count - 1 ? 1 : i + 1; }
            var mesh = new Mesh { vertices = points.ToArray(), triangles = indices }; mesh.RecalculateBounds(); return mesh;
        }

        void OnDestroy()
        {
            Font.textureRebuilt -= FontRebuilt;
            if (backgroundMesh != null && backgroundMesh.sharedMesh != null) Destroy(backgroundMesh.sharedMesh);
            if (background != null) Destroy(background.sharedMaterial);
            if (textRenderer != null) Destroy(textRenderer.sharedMaterial);
        }
    }
}
