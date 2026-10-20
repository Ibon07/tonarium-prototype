using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        string drawingStroke;
        void OnGUI()
        {
            if (labelStyle == null)
            {
                labelStyle = new GUIStyle(GUI.skin.label) { font = font, fontSize = 16, normal = { textColor = Color.white } };
                titleStyle = new GUIStyle(labelStyle) { fontSize = 25, fontStyle = FontStyle.Bold };
                bodyStyle = new GUIStyle(labelStyle) { wordWrap = true, richText = false };
                buttonStyle = new GUIStyle(GUI.skin.button) { font = font, fontSize = 16, padding = new RectOffset(14,14,10,10) };
                panelTexture = new Texture2D(1, 1); panelTexture.SetPixel(0, 0, new Color(.08f,.1f,.13f,.93f)); panelTexture.Apply();
                GUI.skin.font = font; GUI.skin.textField.fontSize = 18; GUI.skin.textArea.fontSize = 18;
            }
            if (!embedded)
            {
                GUI.DrawTexture(new Rect(20, 18, Mathf.Min(370,Screen.width-40), 87), panelTexture);
                GUI.Label(new Rect(37, 27, Screen.width-74, 32), "tonarium   /   " + WorldName(world), titleStyle);
                GUI.Label(new Rect(37, 66, Screen.width-74, 27), playerName + "   ·   " + (avatars.Count + 1) + " 人   ·   " + bridge.Status, labelStyle);
            }
            if (GUI.Button(new Rect(Screen.width - 140, embedded ? 10 : 24, 128, 36), "2D に戻る  F2", buttonStyle)) ReturnTo2D();
            string help = Screen.width < 700 ? "WASD 移動 · Space ジャンプ\nE 操作 · 右クリック 運ぶ · Esc メニュー" : "WASD 移動  ·  マウス 視点  ·  Space ジャンプ  ·  E 操作  ·  右クリック 運ぶ  ·  Enter チャット  ·  Esc メニュー";
            var helpStyle = new GUIStyle(labelStyle) { fontSize = Screen.width < 700 ? 12 : 16, wordWrap = true };
            float helpHeight = Screen.width < 700 ? 44 : 28;
            GUI.DrawTexture(new Rect(8, Screen.height-helpHeight-8, Screen.width-16, helpHeight), panelTexture);
            GUI.Label(new Rect(16, Screen.height-helpHeight-6, Screen.width-32, helpHeight), help, helpStyle);
            if (Cursor.lockState == CursorLockMode.Locked)
            {
                GUI.Label(new Rect(Screen.width / 2f - 5, Screen.height / 2f - 15, 20, 30), "+", labelStyle);
                if (Aim(out var target))
                {
                    string text = target.Id.StartsWith("user:") ? "E · つんつん" : "E · " + (items.TryGetValue(target.Id, out var item) ? KindName((string)item["kind"]) : "操作") + "    右クリック · 運ぶ";
                    GUI.Label(new Rect(12, Screen.height / 2f + 28, Screen.width-24, 50), text, helpStyle);
                }
            }
            int visible = Math.Min(chat.Count, 4);
            if (visible > 0 && !embedded)
            {
                GUI.DrawTexture(new Rect(24, Screen.height - 190, 520, 116), panelTexture);
                for (int i = 0; i < visible; i++) GUI.Label(new Rect(38, Screen.height - 184 + i * 26, 490, 25), chat[chat.Count - visible + i], labelStyle);
            }
            if (!string.IsNullOrEmpty(notice)) GUI.Label(new Rect(12, embedded ? 55 : 110, Screen.width-24, 45), notice, bodyStyle);
            if (chatOpen)
            {
                GUI.SetNextControlName("chat"); draft = GUI.TextField(new Rect(12, Screen.height - 90, Screen.width-110, 36), draft);
                GUI.FocusControl("chat");
                if (GUI.Button(new Rect(Screen.width-90, Screen.height - 90, 78, 36), "送信", buttonStyle)) { SendChat(); chatOpen = false; }
            }
            if (menu) MenuGUI();
            if (selected != null && items.TryGetValue(selected, out var selectedItem)) ItemGUI(selectedItem);
        }

        void MenuGUI()
        {
            float width = Mathf.Min(470,Screen.width-16), height = Mathf.Min(480,Screen.height-16);
            var box = new Rect((Screen.width-width)/2, (Screen.height-height)/2, width, height); GUI.DrawTexture(box, panelTexture);
            GUILayout.BeginArea(new Rect(box.x + 25, box.y + 18, box.width - 50, box.height - 36));
            GUILayout.Label("空間のメニュー", titleStyle); GUILayout.Space(12);
            GUILayout.Label("ワールド", labelStyle); GUILayout.BeginHorizontal();
            foreach (var kind in new[] { "room", "cafe", "game" }) if (GUILayout.Button(WorldName(kind), buttonStyle)) { Room(new { t = "world", world = kind }); if (!bridge.Connected) BuildWorld(kind); menu = false; }
            GUILayout.EndHorizontal(); GUILayout.Space(16); GUILayout.Label("アイテムを置く", labelStyle);
            string[] kinds = { "note", "hammer", "chess", "chessAi", "canvas", "camera", "dice", "g2048" };
            for (int i = 0; i < kinds.Length; i += 2)
            {
                GUILayout.BeginHorizontal();
                for (int j = i; j < Math.Min(i + 2, kinds.Length); j++) if (GUILayout.Button(KindName(kinds[j]), buttonStyle))
                {
                    var pos = controller.transform.position + controller.transform.forward * 2;
                    Room(new { t = "itemCreate", kind = kinds[j], x = pos.x, z = -pos.z, ry = -yaw * Mathf.Deg2Rad }); menu = false;
                }
                GUILayout.EndHorizontal();
            }
            GUILayout.Space(18);
            if (GUILayout.Button("空間に戻る", buttonStyle)) menu = false;
            GUILayout.EndArea();
        }

        void ItemGUI(JObject item)
        {
            string kind = (string)item["kind"];
            float width = Mathf.Min(500,Screen.width-16), height = Mathf.Min(430,Screen.height-16);
            var box = new Rect((Screen.width-width)/2, (Screen.height-height)/2, width, height); GUI.DrawTexture(box, panelTexture);
            GUILayout.BeginArea(new Rect(box.x + 22, box.y + 18, box.width - 44, box.height - 36));
            GUILayout.Label(KindName(kind), titleStyle);
            if (kind == "note")
            {
                noteDraft = GUILayout.TextArea(noteDraft, 300, GUILayout.Height(220));
                if (GUILayout.Button("保存", buttonStyle)) { Room(new { t = "itemAction", id = selected, action = new { a = "noteEdit", text = noteDraft } }); selected = null; }
            }
            else if (kind == "g2048")
            {
                GUILayout.Label(GridText(item["grid"] as JArray, 4), titleStyle);
                GUILayout.BeginHorizontal(); foreach (string d in new[] { "left", "up", "down", "right" }) if (GUILayout.Button(d == "left" ? "←" : d == "up" ? "↑" : d == "down" ? "↓" : "→", buttonStyle)) Room(new { t = "itemAction", id = selected, action = new { a = "slide", dir = d } }); GUILayout.EndHorizontal();
                GUILayout.Label("スコア " + (string)item["score"], labelStyle);
            }
            else if (kind == "video")
            {
                if (GUILayout.Button((bool?)item["clock"]?["playing"] == true ? "一時停止" : "再生", buttonStyle)) Room(new { t = "itemAction", id = selected, action = new { a = (bool?)item["clock"]?["playing"] == true ? "mediaPause" : "mediaPlay", pos = MediaTime(item) } });
            }
            else if (kind == "youtube")
            {
                GUILayout.Label((string)item["title"], bodyStyle);
                if (GUILayout.Button("YouTube を開く", buttonStyle)) Application.OpenURL("https://www.youtube.com/watch?v=" + (string)item["videoId"]);
            }
            else if (kind == "canvas")
            {
                var canvas = GUILayoutUtility.GetRect(1, Mathf.Min(278,height-145), GUILayout.ExpandWidth(true));
                GUI.DrawTexture(canvas, Texture2D.whiteTexture);
                if (item["strokes"] is JArray strokes)
                    foreach (var token in strokes)
                    {
                        var points = token["pts"] as JArray;
                        if (points == null) continue;
                        Color color = (string)token["color"] == "erase" ? Color.white : ColorValue((string)token["color"]);
                        for (int i = 2; i + 1 < points.Count; i += 2)
                            DrawLine(new Vector2(canvas.x + (float)points[i - 2] / 620 * canvas.width, canvas.y + (float)points[i - 1] / 450 * canvas.height),
                                new Vector2(canvas.x + (float)points[i] / 620 * canvas.width, canvas.y + (float)points[i + 1] / 450 * canvas.height), color, (float?)token["size"] ?? 3);
                    }
                var ev = Event.current;
                if (canvas.Contains(ev.mousePosition) && (ev.type == EventType.MouseDown || ev.type == EventType.MouseDrag))
                {
                    float x = (ev.mousePosition.x - canvas.x) / canvas.width * 620;
                    float y = (ev.mousePosition.y - canvas.y) / canvas.height * 450;
                    if (ev.type == EventType.MouseDown)
                    {
                        drawingStroke = Guid.NewGuid().ToString();
                        Room(new { t = "itemAction", id = selected, action = new { a = "strokeStart", id = drawingStroke, color = "#334155", size = 4, x, y } });
                    }
                    else if (drawingStroke != null) Room(new { t = "itemAction", id = selected, action = new { a = "strokeAdd", id = drawingStroke, pts = new[] { x, y } } });
                    ev.Use();
                }
                if (ev.type == EventType.MouseUp) drawingStroke = null;
            }
            if (GUILayout.Button("2D のパネルで開く", buttonStyle)) { bridge.Send(new { t = "openItem", id = selected }); selected = null; }
            if (GUILayout.Button("閉じる", buttonStyle)) selected = null;
            GUILayout.EndArea();
        }

        static void DrawLine(Vector2 a, Vector2 b, Color color, float width)
        {
            var matrix = GUI.matrix;
            var oldColor = GUI.color;
            GUI.color = color;
            GUIUtility.RotateAroundPivot(Mathf.Atan2(b.y-a.y, b.x-a.x)*Mathf.Rad2Deg, a);
            GUI.DrawTexture(new Rect(a.x,a.y-width/2,Vector2.Distance(a,b),width),Texture2D.whiteTexture);
            GUI.matrix = matrix; GUI.color = oldColor;
        }
    }
}
