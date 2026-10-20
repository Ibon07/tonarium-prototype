using System;
using System.Collections;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.Video;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        void ApplyItem(JObject item)
        {
            if (item == null || item["id"] == null) return;
            string id = (string)item["id"];
            items[id] = item;
            RemoveItemObject(id);
            var root = new GameObject("Item " + id); root.transform.position = Position(item); root.transform.rotation = Quaternion.Euler(0, -Float(item, "ry") * Mathf.Rad2Deg, 0);
            root.AddComponent<WorldTarget>().Id = id;
            itemObjects[id] = root;
            string kind = (string)item["kind"];
            if (kind == "hammer")
            {
                Box(root.transform, "Handle", new Vector3(0, .45f, 0), new Vector3(.08f, .7f, .08f), "#a76f43");
                Box(root.transform, "Hammer", new Vector3(0, .84f, 0), new Vector3(.5f, .25f, .25f), "#efb26b");
            }
            else if (kind == "camera")
            {
                Box(root.transform, "Camera", new Vector3(0, .85f, 0), new Vector3(.45f, .28f, .2f), "#30343b");
                Cylinder(root.transform, "Lens", new Vector3(0, .85f, -.16f), .11f, .15f, "#91b6c3").transform.localRotation = Quaternion.Euler(90, 0, 0);
            }
            else if (kind == "chess" || kind == "chessAi") BuildChess(root.transform, item);
            else if (kind == "dice")
            {
                Cylinder(root.transform, "Bowl", new Vector3(0, .65f, 0), .55f, .12f, "#95613c");
                for (int i = 0; i < 3; i++)
                {
                    var die = Box(root.transform, "Die", new Vector3((i - 1) * .25f, .79f, 0), Vector3.one * .2f, "#faf6e9");
                    Label(die.transform, "5", new Vector3(0, .11f, 0), .06f);
                }
            }
            else
            {
                bool note = kind == "note";
                string color = note ? (string)item["color"] ?? "#fde68a" : "#f6f4ed";
                var board = Box(root.transform, "Panel", new Vector3(0, 1.15f, 0), new Vector3(note ? 1 : 1.8f, note ? .8f : 1.2f, .06f), color);
                string caption = note ? (string)item["text"] : KindName(kind);
                if (kind == "g2048") caption += "\n" + GridText(item["grid"] as JArray, 4);
                if (kind == "youtube") caption += "\n" + (string)item["title"];
                var text = Label(root.transform, Wrap(caption ?? "付箋", 18), new Vector3(0, 1.2f, -.041f), note ? .045f : .06f);
                text.color = new Color(.15f, .17f, .2f);
                if (kind == "image") { text.text = ""; StartCoroutine(LoadImage(board, (string)item["url"])); }
                if (kind == "canvas") { text.text = ""; DrawCanvas(root.transform, item); }
                if (kind == "video")
                {
                    text.text = "";
                    var video = board.AddComponent<VideoPlayer>(); video.url = serverUrl + (string)item["url"];
                    video.renderMode = VideoRenderMode.MaterialOverride; video.targetMaterialRenderer = board.GetComponent<Renderer>(); video.targetMaterialProperty = "_MainTex";
                    video.isLooping = true; video.audioOutputMode = VideoAudioOutputMode.AudioSource;
                    var audio = board.AddComponent<AudioSource>(); audio.spatialBlend = 1; audio.minDistance = 2; audio.maxDistance = 15;
                    video.SetTargetAudioSource(0, audio);
                    video.prepareCompleted += v => { v.time = MediaTime(item); if ((bool?)item["clock"]?["playing"] == true) v.Play(); };
                    video.Prepare();
                }
                Cylinder(root.transform, "Stand", new Vector3(0, .4f, 0), .04f, .8f, "#737b86");
                Cylinder(root.transform, "Base", new Vector3(0, .03f, 0), .32f, .06f, "#737b86");
            }
            if (kind == "hammer" || kind == "camera")
            {
                string holder = (string)item["holder"];
                if (holder == selfId) held = id;
                else if (held == id) held = null;
            }
        }

        IEnumerator LoadImage(GameObject panel, string url)
        {
            using (var request = UnityWebRequestTexture.GetTexture(serverUrl + url))
            {
                yield return request.SendWebRequest();
                if (request.result == UnityWebRequest.Result.Success && panel != null)
                    panel.GetComponent<Renderer>().material.mainTexture = DownloadHandlerTexture.GetContent(request);
            }
        }

        void BuildChess(Transform root, JObject item)
        {
            Box(root, "Table", new Vector3(0, .72f, 0), new Vector3(1.7f, .1f, 1.7f), "#744a36");
            var board = item["board"] as JArray;
            for (int i = 0; i < 64; i++)
            {
                float x = (i % 8 - 3.5f) * .19f, z = (i / 8 - 3.5f) * .19f;
                var square = Box(root, "Square", new Vector3(x, .78f, z), new Vector3(.19f, .02f, .19f), (i / 8 + i % 8) % 2 == 0 ? "#ebe0c8" : "#637e72");
                square.AddComponent<ChessSquare>().Index = i;
                string piece = board != null && i < board.Count ? (string)board[i] : null;
                if (!string.IsNullOrEmpty(piece))
                {
                    var p = Cylinder(root, "Piece", new Vector3(x, .9f, z), .057f, piece.EndsWith("P") ? .18f : .26f, piece[0] == 'w' ? "#fff3de" : "#353237");
                    Label(p.transform, piece.Substring(1), new Vector3(0, .17f, 0), .025f);
                    p.AddComponent<ChessSquare>().Index = i;
                }
            }
            for (int x = -1; x <= 1; x += 2) for (int z = -1; z <= 1; z += 2)
                Box(root, "Leg", new Vector3(x * .65f, .35f, z * .65f), new Vector3(.08f, .7f, .08f), "#744a36");
        }

        void DrawCanvas(Transform root, JObject item)
        {
            if (!(item["strokes"] is JArray strokes)) return;
            foreach (var stroke in strokes.OfType<JObject>())
            {
                if (!(stroke["pts"] is JArray pts) || pts.Count < 4) continue;
                var line = new GameObject("Stroke"); line.transform.SetParent(root, false);
                var renderer = line.AddComponent<LineRenderer>(); renderer.useWorldSpace = false;
                renderer.material = new Material(Shader.Find("Sprites/Default"));
                var color = ColorValue((string)stroke["color"] == "erase" ? "#f6f4ed" : (string)stroke["color"]);
                renderer.startColor = renderer.endColor = color; renderer.startWidth = renderer.endWidth = Float(stroke, "size", 3) / 620 * 1.8f;
                renderer.positionCount = pts.Count / 2;
                for (int i = 0; i < pts.Count / 2; i++) renderer.SetPosition(i, new Vector3(((float)pts[i * 2] / 620 - .5f) * 1.8f, 1.75f - (float)pts[i * 2 + 1] / 450 * 1.2f, -.041f));
            }
        }

        void RemoveItemObject(string id) { if (itemObjects.TryGetValue(id, out var old)) Destroy(old); itemObjects.Remove(id); }
        void RemoveItem(string id) { if (id == null) return; RemoveItemObject(id); items.Remove(id); if (selected == id) selected = null; if (held == id) held = null; }
        double MediaTime(JObject item) => Float(item["clock"] as JObject, "base") + ((bool?)item["clock"]?["playing"] == true ? Math.Max(0, Now - ((double?)item["clock"]?["at"] ?? Now)) / 1000 : 0);
    }
}
