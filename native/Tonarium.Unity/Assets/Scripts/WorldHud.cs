using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
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
            GUI.DrawTexture(new Rect(20, 18, 370, 87), panelTexture);
            GUI.Label(new Rect(37, 27, 320, 32), "tonarium   /   " + WorldName(world), titleStyle);
            GUI.Label(new Rect(37, 66, 340, 27), playerName + "   ·   " + (avatars.Count + 1) + " 人   ·   " + bridge.Status, labelStyle);
            if (GUI.Button(new Rect(Screen.width - 156, 24, 132, 42), "2D に戻る  F2", buttonStyle)) ReturnTo2D();
            GUI.Label(new Rect(24, Screen.height - 40, 1200, 28), "WASD 移動  ·  マウス 視点  ·  Space ジャンプ  ·  E 操作  ·  右クリック 運ぶ  ·  Enter チャット  ·  Esc メニュー", labelStyle);
            if (Cursor.lockState == CursorLockMode.Locked)
            {
                GUI.Label(new Rect(Screen.width / 2f - 5, Screen.height / 2f - 15, 20, 30), "+", labelStyle);
                if (Aim(out var target))
                {
                    string text = target.Id.StartsWith("user:") ? "E · つんつん" : "E · " + (items.TryGetValue(target.Id, out var item) ? KindName((string)item["kind"]) : "操作") + "    右クリック · 運ぶ";
                    GUI.Label(new Rect(Screen.width / 2f - 150, Screen.height / 2f + 28, 420, 30), text, labelStyle);
                }
            }
            int visible = Math.Min(chat.Count, 4);
            if (visible > 0)
            {
                GUI.DrawTexture(new Rect(24, Screen.height - 190, 520, 116), panelTexture);
                for (int i = 0; i < visible; i++) GUI.Label(new Rect(38, Screen.height - 184 + i * 26, 490, 25), chat[chat.Count - visible + i], labelStyle);
            }
            if (!string.IsNullOrEmpty(notice)) GUI.Label(new Rect(Screen.width / 2 - 240, 90, 600, 30), notice, labelStyle);
            if (chatOpen)
            {
                GUI.SetNextControlName("chat"); draft = GUI.TextField(new Rect(24, Screen.height - 78, 430, 36), draft);
                GUI.FocusControl("chat");
                if (GUI.Button(new Rect(463, Screen.height - 78, 80, 36), "送信", buttonStyle)) { SendChat(); chatOpen = false; }
            }
            if (menu) MenuGUI();
            if (selected != null && items.TryGetValue(selected, out var selectedItem)) ItemGUI(selectedItem);
        }

        void MenuGUI()
        {
            var box = new Rect(Screen.width / 2 - 235, Screen.height / 2 - 240, 470, 480); GUI.DrawTexture(box, panelTexture);
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
                    Room(new { t = "itemCreate", kind = kinds[j], x = pos.x, z = pos.z, ry = (180 - yaw) * Mathf.Deg2Rad }); menu = false;
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
            var box = new Rect(Screen.width / 2 - 250, Screen.height / 2 - 215, 500, 430); GUI.DrawTexture(box, panelTexture);
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
            else if (kind == "canvas") GUILayout.Label("共同キャンバスの内容を空間に表示しています。描画は 2D のキャンバスから行えます。", bodyStyle);
            if (GUILayout.Button("閉じる", buttonStyle)) selected = null;
            GUILayout.EndArea();
        }
    }
}
