using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        sealed class LiveScreenVisual
        {
            public GameObject Root, Front, Back, Frame, Pole, Base, Dot;
            public WorldPill Label;
            public float Width, Height;
        }
        readonly Dictionary<string, GameObject> liveScreens = new Dictionary<string, GameObject>();
        readonly Dictionary<string, Texture2D> liveTextures = new Dictionary<string, Texture2D>();
        readonly Dictionary<string, LiveScreenVisual> liveVisuals = new Dictionary<string, LiveScreenVisual>();

        void ReceiveVideo(JObject message)
        {
            string identity = (string)message["identity"], jpeg = (string)message["jpeg"];
            if (string.IsNullOrEmpty(identity)) return;
            if (string.IsNullOrEmpty(jpeg))
            {
                if (liveScreens.TryGetValue(identity, out var screen)) Destroy(screen);
                if (liveTextures.TryGetValue(identity, out var texture)) Destroy(texture);
                liveScreens.Remove(identity); liveTextures.Remove(identity); liveVisuals.Remove(identity); return;
            }
            if (!liveVisuals.TryGetValue(identity, out var visual))
            {
                var root = new GameObject("Live screen " + identity); root.transform.SetParent(transform, false);
                root.AddComponent<WorldTarget>().Id = "display:" + identity;
                root.AddComponent<BoxCollider>();
                var video = new Texture2D(2, 2, TextureFormat.RGB24, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
                visual = new LiveScreenVisual { Root = root,
                    Front = VideoFace(root.transform, "Front", video, false), Back = VideoFace(root.transform, "Back", video, true),
                    Frame = ScreenPart(root.transform, "Frame", PrimitiveType.Cube, "#1e1f24"),
                    Pole = ScreenPart(root.transform, "Stand", PrimitiveType.Cylinder, "#2c2d33"),
                    Base = ScreenPart(root.transform, "Base", PrimitiveType.Cylinder, "#2c2d33"),
                    Dot = ScreenPart(root.transform, "Live", PrimitiveType.Sphere, "#ef4444") };
                visual.Label = WorldPill.Create(root.transform, font, Vector3.zero, .16f);
                liveScreens[identity] = root; liveTextures[identity] = video; liveVisuals[identity] = visual;
            }
            try { liveTextures[identity].LoadImage(Convert.FromBase64String(jpeg)); }
            catch (FormatException) { }
        }

        static GameObject VideoFace(Transform parent, string name, Texture texture, bool back)
        {
            var face = GameObject.CreatePrimitive(PrimitiveType.Quad); face.name = name; face.transform.SetParent(parent, false);
            Destroy(face.GetComponent<Collider>());
            face.transform.localPosition = new Vector3(0, 0, back ? .026f : -.026f);
            if (back) face.transform.localRotation = Quaternion.Euler(0, 180, 0);
            face.GetComponent<Renderer>().sharedMaterial = new Material(Shader.Find("Unlit/Texture")) { mainTexture = texture };
            return face;
        }

        static GameObject ScreenPart(Transform parent, string name, PrimitiveType kind, string color)
        {
            var part = GameObject.CreatePrimitive(kind); part.name = name; part.transform.SetParent(parent, false);
            Destroy(part.GetComponent<Collider>());
            part.GetComponent<Renderer>().sharedMaterial = Material(color);
            return part;
        }

        void SetVideoSize(LiveScreenVisual v, float width, float height, float centerY, bool camera, bool standing)
        {
            v.Front.transform.localScale = v.Back.transform.localScale = new Vector3(width, height, 1);
            v.Front.transform.localPosition = new Vector3(0, centerY, -.026f);
            v.Back.transform.localPosition = new Vector3(0, centerY, .026f);
            v.Frame.transform.localPosition = Vector3.up * centerY;
            v.Frame.transform.localScale = new Vector3(width + (camera ? .04f : .06f), height + (camera ? .04f : .06f), .05f);
            v.Pole.SetActive(standing); v.Base.SetActive(standing); v.Dot.SetActive(camera);
            v.Pole.transform.localPosition = Vector3.up * .85f; v.Pole.transform.localScale = new Vector3(.06f, .85f, .06f);
            v.Base.transform.localPosition = Vector3.up * .02f; v.Base.transform.localScale = new Vector3(.72f, .02f, .72f);
            v.Dot.transform.localPosition = new Vector3(-.27f, centerY + .15f, -.03f); v.Dot.transform.localScale = Vector3.one * .04f;
            var collider = v.Root.GetComponent<BoxCollider>(); collider.enabled = standing;
            collider.center = Vector3.up * centerY; collider.size = new Vector3(width + .06f, height + .06f, .06f);
            v.Width = width; v.Height = height;
        }

        void UpdateVideoScreens()
        {
            foreach (var pair in liveVisuals)
            {
                var visual = pair.Value; var root = visual.Root.transform;
                bool camera = pair.Key.StartsWith("camera:");
                if (camera)
                {
                    string id = pair.Key.Substring(7);
                    if (!items.TryGetValue(id, out var item) || (bool?)item["live"] != true) { visual.Root.SetActive(false); continue; }
                    visual.Root.SetActive(true);
                    string holder = (string)item["holder"];
                    Transform owner = holder == selfId ? controller.transform : holder != null && avatars.TryGetValue(holder, out var avatar) ? avatar.transform : null;
                    if (owner != null) root.position = owner.position + Vector3.up * 1.95f;
                    else if (itemObjects.TryGetValue(id, out var model)) root.position = model.transform.position + Vector3.up * 1.92f;
                    else root.position = Position(item) + Vector3.up * 1.92f;
                    root.rotation = eye.transform.rotation;
                    SetVideoSize(visual, .68f, .38f, 0, true, false); visual.Label.gameObject.SetActive(false);
                    continue;
                }
                var user = users.OfType<JObject>().FirstOrDefault(u => (string)u["id"] == pair.Key && (string)u["session"] == sessionId);
                bool head = (string)user?["mode"] == "2d";
                var display = (user?["display"] ?? presence[pair.Key]?["display"]) as JObject;
                if (user == null || (!head && display == null)) { visual.Root.SetActive(false); continue; }
                visual.Root.SetActive(true);
                float aspect = liveTextures[pair.Key].width / (float)Mathf.Max(1, liveTextures[pair.Key].height), width = head ? .9f : 1.6f;
                float height = width / aspect, centerY;
                if (head)
                {
                    if (!avatars.TryGetValue(pair.Key, out var avatar)) { visual.Root.SetActive(false); continue; }
                    root.position = new Vector3(avatar.transform.position.x, avatar.transform.localScale.x < .7f ? .75f : 1.55f, avatar.transform.position.z);
                    var direction = root.position - eye.transform.position; direction.y = 0;
                    if (direction.sqrMagnitude > .001f) root.rotation = Quaternion.LookRotation(direction);
                    centerY = .15f + height / 2;
                }
                else
                {
                    bool carried = carrying == "display:" + pair.Key;
                    var target = carried ? controller.transform.position + controller.transform.forward * 2 : Position(display); target.y = 0;
                    root.position = Vector3.Lerp(root.position, target, carried ? 1 : Mathf.Min(1, Time.deltaTime * 12));
                    root.rotation = Quaternion.Slerp(root.rotation, Quaternion.Euler(0, carried ? yaw : -Float(display, "ry") * Mathf.Rad2Deg, 0), carried ? 1 : Mathf.Min(1, Time.deltaTime * 12));
                    centerY = 1.5f + height / 2;
                }
                SetVideoSize(visual, width, height, centerY, false, !head);
                visual.Label.gameObject.SetActive(true);
                visual.Label.transform.localPosition = Vector3.up * (centerY + height / 2 + (head ? .11f : .16f));
                visual.Label.transform.localScale = Vector3.one * (head ? .6875f : 1);
                visual.Label.Set("● " + ((string)user["name"] ?? pair.Key) + " の配信", new Color(.851f, .282f, .231f, .95f), Color.white);
            }
        }
    }
}
