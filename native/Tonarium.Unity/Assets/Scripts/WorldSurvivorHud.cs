using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        Vector2 survivorLibraryScroll;
        Texture2D survivorDisc;
        readonly System.Collections.Generic.Dictionary<int, Texture2D> survivorRings = new System.Collections.Generic.Dictionary<int, Texture2D>();
        float survivorPanelWidth, survivorContentWidth;
        GUIStyle SurvivorText(int size = 12, string color = "#f5eaf1") => new GUIStyle(labelStyle) { fontSize = size, wordWrap = true, normal = { textColor = ColorValue(color) } };
        GUIStyle SurvivorCard(string color = "#302333") => new GUIStyle(buttonStyle) {
            fontSize = 11, wordWrap = true, alignment = TextAnchor.UpperLeft, padding = new RectOffset(8, 8, 8, 8),
            normal = { background = HudTexture(color), textColor = ColorValue("#f7eaf2") },
            hover = { background = HudTexture("#765253"), textColor = ColorValue("#fff2d0") },
            active = { background = HudTexture("#483043"), textColor = Color.white }
        };
        bool SurvivorButton(string id, string text, GUIStyle style = null, params GUILayoutOption[] options)
        {
            bool pressed = GUILayout.Button(text, style ?? SurvivorCard(), options);
            if (Event.current.type == EventType.Repaint)
            {
                var rect = GUILayoutUtility.GetLastRect();
                var point = GUIUtility.GUIToScreenPoint(rect.position);
                var end = GUIUtility.GUIToScreenPoint(rect.position + rect.size);
                survivorHudControls[id] = new Rect(point, end - point);
            }
            if (pressed) GUI.FocusControl(null);
            return pressed;
        }
        static string SurvivorRarity(string rarity) => rarity == "mythic" ? "神話" : rarity == "epic" ? "英雄" : rarity == "rare" ? "希少" : "一般";
        string SurvivorGearInfo(string id)
        {
            var gear = SurvivorCatalog["gear"]?[id];
            string partner = (string)gear?["synergy"] ?? ((JObject)SurvivorCatalog["gear"]).Properties().FirstOrDefault(p => (string)p.Value["synergy"] == id)?.Name;
            string info = (string)gear?["desc"] ?? "";
            if (partner != null) info += "\nシナジー: " + SurvivorName("gear", partner);
            if (gear?["evolvedFrom"] is JArray evolved) info += "\n進化条件: " + string.Join(" + ", evolved.Select(x => SurvivorName("gear", (string)x)));
            return info;
        }
        void SurvivorBar(string caption, float value, float maximum, string color)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(caption, SurvivorText(10), GUILayout.Width(40));
            var rect = GUILayoutUtility.GetRect(20, 8, GUILayout.ExpandWidth(true));
            rect.y += 5;
            HudPanel(rect, "#433642");
            HudPanel(new Rect(rect.x, rect.y, rect.width * Mathf.Clamp01(value / Mathf.Max(1, maximum)), rect.height), color);
            GUILayout.Label($"{Mathf.CeilToInt(value)} / {maximum:0}", SurvivorText(10), GUILayout.Width(76));
            GUILayout.EndHorizontal();
        }
        float SurvivorHudHalf => (float)SurvivorCatalog["constants"]["roomHalf"];
        Vector2 SurvivorHudJoin => new Vector2((float)SurvivorCatalog["constants"]["join"]["x"], (float)SurvivorCatalog["constants"]["join"]["z"]);
        float SurvivorHudJoinRadius => (float)SurvivorCatalog["constants"]["join"]["r"];
        Vector2 SurvivorMapPoint(Rect rect, float x, float z) => rect.center + new Vector2(x, z) * (rect.width / (SurvivorHudHalf * 2));
        void SurvivorMapLine(Vector2 a, Vector2 b, Color color, float width)
        {
            var previous = GUI.color;
            GUI.color = color;
            // GUI の回転は ScrollView の clip も回転して縦線が消えるため使わない。
            if (Mathf.Abs(a.x - b.x) < .01f)
                GUI.DrawTexture(new Rect(a.x - width / 2, Mathf.Min(a.y, b.y), width, Mathf.Abs(a.y - b.y)), Texture2D.whiteTexture);
            else if (Mathf.Abs(a.y - b.y) < .01f)
                GUI.DrawTexture(new Rect(Mathf.Min(a.x, b.x), a.y - width / 2, Mathf.Abs(a.x - b.x), width), Texture2D.whiteTexture);
            else
            {
                int steps = Mathf.Max(1, Mathf.CeilToInt(Vector2.Distance(a, b)));
                for (int i = 0; i <= steps; i++)
                {
                    var p = Vector2.Lerp(a, b, (float)i / steps);
                    GUI.DrawTexture(new Rect(p.x - width / 2, p.y - width / 2, width, width), Texture2D.whiteTexture);
                }
            }
            GUI.color = previous;
        }
        void SurvivorMapCircle(Vector2 center, float radius, Color color, bool filled = true, float width = 2)
        {
            if (filled)
            {
                if (survivorDisc == null)
                {
                    survivorDisc = new Texture2D(64, 64, TextureFormat.RGBA32, false);
                    for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++)
                        survivorDisc.SetPixel(x, y, new Color(1, 1, 1, Mathf.Clamp01(32 - Vector2.Distance(new Vector2(x + .5f, y + .5f), new Vector2(32, 32)))));
                    survivorDisc.Apply();
                }
                var previous = GUI.color; GUI.color = color;
                GUI.DrawTexture(new Rect(center.x - radius, center.y - radius, radius * 2, radius * 2), survivorDisc);
                GUI.color = previous;
            }
            else
            {
                // 円周は距離場から作る。細線を回転させると clip と角の継ぎ目が目立つ。
                int thickness = Mathf.Clamp(Mathf.RoundToInt(width / Mathf.Max(1, radius) * 64), 1, 64);
                if (!survivorRings.TryGetValue(thickness, out var ring))
                {
                    ring = new Texture2D(128, 128, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                    var pixels = new Color[128 * 128];
                    for (int y = 0; y < 128; y++) for (int x = 0; x < 128; x++)
                    {
                        float distance = Vector2.Distance(new Vector2(x + .5f, y + .5f), new Vector2(64, 64));
                        pixels[y * 128 + x] = new Color(1, 1, 1, Mathf.Clamp01(64 - distance) * Mathf.Clamp01(distance - (63 - thickness)));
                    }
                    ring.SetPixels(pixels); ring.Apply(); survivorRings[thickness] = ring;
                }
                var previous = GUI.color; GUI.color = color;
                GUI.DrawTexture(new Rect(center.x - radius, center.y - radius, radius * 2, radius * 2), ring);
                GUI.color = previous;
            }
        }
        static readonly string[] SurvivorMapColors = { "#ff8ab2", "#8ed9ff", "#e1b0ff", "#ffd36d", "#9af0bd" };
        string SurvivorMapAttackColor(string gear)
        {
            switch (gear) { case "moonblade": return "#ff65aa"; case "eclipse": return "#ffe675"; case "bloodaura": return "#ff315e"; case "crimsonsun": return "#ff9d35"; case "starbolt": return "#5fe5ff"; case "starfall": return "#ffe16e"; case "shade": return "#bc8aff"; case "umbralstorm": return "#a457ff"; default: return "#fff3a6"; }
        }
        void SurvivorMap()
        {
            float side = Mathf.Max(32, Mathf.Min(320, survivorContentWidth - 8));
            GUILayout.BeginHorizontal(); GUILayout.FlexibleSpace();
            var rect = GUILayoutUtility.GetRect(side, side, GUILayout.Width(side), GUILayout.Height(side));
            GUILayout.FlexibleSpace(); GUILayout.EndHorizontal();
            if (Event.current.type != EventType.Repaint) return;
            var previous = GUI.color;
            GUI.BeginGroup(rect);
            rect = new Rect(0, 0, side, side);
            GUI.color = SurvivorPaused ? new Color(.76f, .76f, .76f) : Color.white;
            HudPanel(rect, "#565961");
            for (float i = -SurvivorHudHalf; i <= SurvivorHudHalf; i += 2)
            {
                SurvivorMapLine(SurvivorMapPoint(rect, i, -SurvivorHudHalf), SurvivorMapPoint(rect, i, SurvivorHudHalf), new Color(1, 1, 1, .11f), 1);
                SurvivorMapLine(SurvivorMapPoint(rect, -SurvivorHudHalf, i), SurvivorMapPoint(rect, SurvivorHudHalf, i), new Color(1, 1, 1, .11f), 1);
            }
            SurvivorMapLine(rect.min, new Vector2(rect.xMax, rect.yMin), ColorValue("#aeb1bb"), 3);
            SurvivorMapLine(new Vector2(rect.xMax, rect.yMin), rect.max, ColorValue("#aeb1bb"), 3);
            SurvivorMapLine(rect.max, new Vector2(rect.xMin, rect.yMax), ColorValue("#aeb1bb"), 3);
            SurvivorMapLine(new Vector2(rect.xMin, rect.yMax), rect.min, ColorValue("#aeb1bb"), 3);
            var join = SurvivorMapPoint(rect, SurvivorHudJoin.x, SurvivorHudJoin.y);
            SurvivorMapCircle(join, SurvivorHudJoinRadius * side / (SurvivorHudHalf * 2), ColorValue("#ef6b9b33"));
            SurvivorMapCircle(join, SurvivorHudJoinRadius * side / (SurvivorHudHalf * 2), ColorValue("#ff9ac8"), false);
            int index = 0;
            if ((string)survivor["phase"] == "lobby") foreach (var user in users.OfType<JObject>().Where(u => (string)u["session"] == sessionId))
            {
                string id = (string)user["id"];
                Vector2 pos = SurvivorParticipantPosition(user);
                SurvivorMapCircle(SurvivorMapPoint(rect, pos.x, pos.y), 6 * side / 360, ColorValue(SurvivorMapColors[index++ % 5]));
            }
            foreach (var enemy in (survivor["enemies"] as JArray ?? new JArray()).OfType<JObject>())
            {
                var p = SurvivorMapPoint(rect, Float(enemy, "x"), Float(enemy, "z"));
                if (p.x < -20 || p.x > side + 20 || p.y < -20 || p.y > side + 20) continue;
                string kind = (string)enemy["kind"];
                long hitAge = Now - ((long?)enemy["hitAt"] ?? 0);
                float hit = hitAge >= 0 && hitAge < 240 ? 1 - hitAge / 240f : 0;
                float radius = (kind == "boss" ? 11 : kind == "knight" ? 6 : 4.5f) * (1 + hit * .35f) * side / 360;
                SurvivorMapCircle(p, radius, ColorValue(hit > 0 ? "#fff4f7" : kind == "boss" ? "#ff315d" : kind == "knight" ? "#bd81d0" : kind == "bat" ? "#a17de0" : "#df6287"));
                if (hit > 0 || kind == "boss") SurvivorMapCircle(p, radius + 4, hit > 0 ? new Color(1, 1, 1, hit) : ColorValue("#ff5275CC"), false);
            }
            index = 0;
            foreach (var entry in (survivor["players"] as JObject ?? new JObject()).Properties())
            {
                var p = SurvivorMapPoint(rect, (float)entry.Value["x"], (float)entry.Value["z"]);
                long hitAge = Now - ((long?)entry.Value["hitAt"] ?? 0);
                float hit = hitAge >= 0 && hitAge < 300 ? 1 - hitAge / 300f : 0;
                if (hit > 0) SurvivorMapCircle(p, 12 + (1 - hit) * 8, new Color(1, .43f, .53f, hit), false, 3);
                float radius = (entry.Name == selfId ? 8 : 6) * side / 360;
                SurvivorMapCircle(p, radius, ColorValue(hit > 0 ? "#fff2ee" : SurvivorMapColors[index % 5]));
                if (entry.Name == selfId) SurvivorMapCircle(p, radius, Color.white, false);
                index++;
            }
            foreach (var effect in (survivor["effects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                float age = Now - ((long?)effect["at"] ?? 0); if (age < 0 || age > 650) continue;
                float progress = age / 650, alpha = 1 - progress;
                var from = SurvivorMapPoint(rect, (float)effect["from"]["x"], (float)effect["from"]["z"]);
                string gear = (string)effect["gear"]; var color = ColorValue(SurvivorMapAttackColor(gear)); color.a = alpha;
                if (gear == "moonblade" || gear == "eclipse" || gear == "bloodaura" || gear == "crimsonsun")
                {
                    float radius = Mathf.Max(4, (float)effect["reach"] * side / (SurvivorHudHalf * 2) * (.18f + progress * .82f));
                    SurvivorMapCircle(from, radius, new Color(color.r, color.g, color.b, alpha * .14f));
                    SurvivorMapCircle(from, radius, color, false, 5 * alpha + 1);
                    SurvivorMapCircle(from, radius * .66f, new Color(1, .95f, .81f, alpha), false);
                    SurvivorMapCircle(from, 4 + progress * 5, new Color(1, 1, 1, alpha));
                }
                else foreach (var target in (effect["targets"] as JArray ?? new JArray()).OfType<JObject>())
                {
                    var to = SurvivorMapPoint(rect, Float(target, "x"), Float(target, "z"));
                    SurvivorMapLine(from, to, color, 9); SurvivorMapLine(from, to, new Color(1, .96f, .91f, alpha), 2);
                    SurvivorMapCircle(Vector2.Lerp(from, to, progress), 5, color);
                    SurvivorMapCircle(to, 7 + alpha * 7, new Color(1, 1, 1, alpha), false, 2.5f);
                    for (int i = 0; i < 6; i++) { float a = i * Mathf.PI / 3 + progress * 1.5f; var d = new Vector2(Mathf.Cos(a), Mathf.Sin(a)); float r = (5 + progress * 12) * (i % 2 == 1 ? .72f : 1); SurvivorMapLine(to + d * r, to + d * (r + 4), i % 2 == 1 ? color : new Color(1, 1, 1, alpha), 2); }
                }
            }
            GUI.EndGroup();
            GUI.color = previous;
        }
        Vector2 SurvivorParticipantPosition(JObject user)
        {
            string id = (string)user["id"];
            if (id == selfId) return new Vector2(controller.transform.position.x, -controller.transform.position.z);
            if ((string)user["mode"] == "3d" && avatarStates.TryGetValue(id, out var avatar)) return new Vector2(Float(avatar, "x"), Float(avatar, "z"));
            var p = (user["pos"] ?? presence[id]?["pos"]) as JObject;
            return p == null ? SurvivorHudJoin : new Vector2(Float(p, "x"), Float(p, "z"));
        }
        void SurvivorGUI()
        {
            if (Event.current.type == EventType.Repaint) survivorHudControls.Clear();
            if (world != "survivors" || menu || chatOpen || selected != null) return;
            bool priorEnabled = GUI.enabled;
            bool panelEnabled = priorEnabled && !survivorLibrary;
            GUI.enabled = panelEnabled;
            var me = SurvivorMe; string phase = (string)survivor["phase"] ?? "lobby";
            var choices = me?["choiceQueue"]?.First as JArray;
            survivorPanelWidth = Mathf.Min(390, HudWidth * .34f);
            survivorContentWidth = Mathf.Max(64, survivorPanelWidth - 48);
            var rect = new Rect(HudWidth - survivorPanelWidth - 16, 58, survivorPanelWidth, HudHeight - 74);
            HudPanel(rect, SurvivorPaused ? "#463343F5" : "#1b1520F5");
            GUILayout.BeginArea(new Rect(rect.x + 12, rect.y + 12, rect.width - 24, rect.height - 24));
            survivorScroll.x = 0;
            survivorScroll = GUILayout.BeginScrollView(survivorScroll, false, true, GUIStyle.none, GUI.skin.verticalScrollbar);
            GUILayout.BeginVertical(GUILayout.Width(survivorContentWidth));
            string status = SurvivorPaused ? "装備選択中 · 時が止まっています" : SurvivorActive && me != null && (bool?)me["alive"] != true ? "倒れました · 仲間を観戦中" : phase == "lobby" ? "参加者を待っています" : phase == "running" ? "夜の眷属が迫る" : phase == "boss" ? "夜の王が現れた" : (bool?)survivor["bossDefeated"] == true ? "夜の王を討伐" : "ラン終了";
            GUILayout.BeginHorizontal();
            GUILayout.BeginVertical(); GUILayout.Label((string)SurvivorCatalog["title"], SurvivorText(16, "#fff1f7")); GUILayout.Label(status, SurvivorText(11, "#d4bac8")); GUILayout.EndVertical();
            if (SurvivorActive) { long elapsed = Math.Max(0, (SurvivorPaused ? Math.Min(Now, (long)survivor["pausedAt"]) : Now) - ((long?)survivor["startedAt"] ?? Now)); long seconds = Math.Max(0, ((long)SurvivorCatalog["constants"]["durationMs"] - elapsed + 999) / 1000); GUILayout.Label(phase == "boss" ? "BOSS" : $"{seconds / 60}:{seconds % 60:00}", SurvivorText(20, phase == "boss" ? "#ff5275" : "#fff1f7"), GUILayout.Width(62)); }
            GUILayout.EndHorizontal(); GUILayout.Space(10);
            if (SurvivorPaused) { GUILayout.Label("✦  時が止まった  ✦\n装備を選ぶまで、敵も時間も一時停止中", new GUIStyle(SurvivorText(12, "#fff1cf")) { alignment = TextAnchor.MiddleCenter }, GUILayout.MinHeight(48)); }
            SurvivorMap(); GUILayout.Space(10);
            var boss = (survivor["enemies"] as JArray)?.OfType<JObject>().FirstOrDefault(e => (string)e["kind"] == "boss");
            if (phase == "boss" && boss != null) SurvivorBar("夜の王", Float(boss, "hp"), Float(boss, "maxHp"), "#fa315e");
            GUILayout.Label("✦ 仲間と自分    ◆ 夜の眷属\n攻撃は自動 · 光る軌跡が攻撃" + (SurvivorActive ? "\nWASDで移動 · 俯瞰視点" : ""), SurvivorText(10, "#d5c4d0"));
            if (me != null) { SurvivorBar("Lv. " + me["level"], Float(me, "hp"), Float(me, "maxHp"), "#e45169"); SurvivorBar("EXP", Mathf.Floor(Float(me, "xp")), Float(me, "nextXp"), "#e9c75b"); GUILayout.Label("討伐 " + me["kills"], SurvivorText(10)); }
            GUILayout.Space(10);
            if ((bool?)me?["alive"] == true && choices != null && choices.Count > 0)
            {
                GUILayout.Label("✦ LEVEL UP ✦\n新たな力を選ぶ", new GUIStyle(SurvivorText(15, "#fff2d0")) { alignment = TextAnchor.MiddleCenter });
                GUILayout.Label("選択中はセッション全体が停止します", SurvivorText(9, "#e3cba6"));
                GUILayout.BeginHorizontal();
                foreach (string gear in choices)
                {
                    var rarity = (string)SurvivorCatalog["gear"]?[gear]?["rarity"];
                    string color = rarity == "mythic" ? "#765329" : rarity == "epic" ? "#51365e" : rarity == "rare" ? "#304d65" : "#4f383d";
                    var title = SurvivorName("gear", gear) + "\n" + SurvivorRarity(rarity) + " · Lv." + (SurvivorNumber(me?["gear"]?[gear]) + 1) + "\n" + SurvivorGearInfo(gear);
                    if (SurvivorButton("choose:" + gear, title, SurvivorCard(color), GUILayout.Width((survivorContentWidth - 24) / 3), GUILayout.MinHeight(140))) Room(new { t = "survivorChoose", gear });
                }
                GUILayout.EndHorizontal(); GUILayout.Space(10);
            }
            if (!SurvivorActive || me == null)
            {
                GUILayout.Label(SurvivorActive ? "途中参加" : phase == "ended" ? "次の夜へ" : "スタイルを選ぶ", SurvivorText(13));
                var joined = users.OfType<JObject>().Where(u => (string)u["session"] == sessionId && Vector2.Distance(SurvivorParticipantPosition(u), SurvivorHudJoin) <= SurvivorHudJoinRadius).ToArray();
                bool canJoin = Vector2.Distance(new Vector2(controller.transform.position.x, -controller.transform.position.z), SurvivorHudJoin) <= SurvivorHudJoinRadius;
                GUILayout.BeginHorizontal();
                foreach (var style in ((JObject)SurvivorCatalog["styles"]).Properties())
                {
                    GUI.enabled = panelEnabled && (!SurvivorActive || canJoin);
                    bool chosen = ((string)survivor["stylePicks"]?[selfId] ?? "bloodrose") == style.Name;
                    string title = (string)style.Value["mark"] + (string)style.Value["name"] + "\n" + (string)style.Value["desc"] + "\n初期装備: " + SurvivorName("gear", (string)style.Value["weapon"]) + "\nHP " + style.Value["hp"] + " · 移動 " + ((float)style.Value["speed"]).ToString("0.0");
                    if (SurvivorButton("style:" + style.Name, title, SurvivorCard(chosen ? "#483043" : "#302333"), GUILayout.Width((survivorContentWidth - 24) / 3), GUILayout.MinHeight(132))) Room(new { t = "survivorStyle", style = style.Name });
                }
                GUI.enabled = panelEnabled; GUILayout.EndHorizontal();
                GUILayout.Label("参加エリアに " + joined.Length + " 人 · " + (joined.Length == 0 ? "参加者なし" : string.Join("、", joined.Select(u => (string)u["name"]))), SurvivorText(10, "#d3bfcd"));
                GUI.enabled = panelEnabled && canJoin && (bool?)me?["alive"] != true;
                if (SurvivorButton("start", SurvivorActive ? "レベル1から途中参加" : phase == "ended" ? "もう一度プレイ" : "参加者でゲーム開始", SurvivorCard("#aa3e70"))) Room(new { t = "survivorStart" });
                GUI.enabled = panelEnabled;
                if (!canJoin) GUILayout.Label("参加エリアの輪の中に入ると参加できます", SurvivorText(10, "#d8bdcc"));
                if (phase == "ended" && me != null) GUILayout.Label("今回の獲得ポイント: +" + me["level"] + " pt", SurvivorText(12, "#ffe2a1"));
            }
            if (me?["gear"] is JObject gearMap) { GUILayout.Space(10); GUILayout.Label("装備", SurvivorText(12)); foreach (var gear in gearMap.Properties().Where(g => (int)g.Value > 0)) GUILayout.Label(SurvivorName("gear", gear.Name) + " Lv." + gear.Value, SurvivorText(10)); }
            GUILayout.Space(10); GUILayout.Label("永続強化    " + (survivorProfile["points"] ?? 0) + " pt", SurvivorText(13));
            if (SurvivorButton("library", "装備図鑑・実績を開く")) survivorLibrary = true;
            int invested = 0;
            foreach (var upgrade in ((JObject)SurvivorCatalog["upgrades"]).Properties())
            {
                int level = (int)SurvivorNumber(survivorProfile["upgrades"]?[upgrade.Name]); int cost = (int)upgrade.Value["cost"], max = (int)upgrade.Value["max"];
                invested += level * cost;
                GUI.enabled = panelEnabled && SurvivorNumber(survivorProfile["points"]) >= cost && level < max;
                if (SurvivorButton("upgrade:" + upgrade.Name, (string)upgrade.Value["name"] + " Lv." + level + "/" + max + "    " + (level >= max ? "MAX" : cost + " pt") + "\n" + (string)upgrade.Value["desc"])) Room(new { t = "survivorUpgrade", upgrade = upgrade.Name });
            }
            GUI.enabled = panelEnabled;
            if (invested > 0)
            {
                if (SurvivorActive) GUILayout.Label("強化のリセットはラン終了後にできます", SurvivorText(10));
                else if (survivorResetConfirm)
                {
                    GUILayout.Label($"すべての永続強化を Lv.0 に戻し、{invested} ptを返却します。", SurvivorText(11));
                    if (SurvivorButton("reset", $"リセットして {invested} pt を受け取る")) { Room(new { t = "survivorReset" }); survivorResetConfirm = false; }
                    if (SurvivorButton("resetCancel", "キャンセル")) survivorResetConfirm = false;
                }
                else if (SurvivorButton("reset", $"永続強化をリセット  +{invested} pt 返却")) survivorResetConfirm = true;
            }
            GUILayout.EndVertical(); GUILayout.EndScrollView(); GUILayout.EndArea();
            GUI.enabled = priorEnabled;
            if (survivorLibrary) SurvivorLibraryGUI();
            if (rect.Contains(Event.current.mousePosition) && Event.current.type == EventType.MouseDown) Event.current.Use();
        }
        void SurvivorLibraryGUI()
        {
            var rect = new Rect(Mathf.Max(12, (HudWidth - 650) / 2), 72, Mathf.Min(650, HudWidth - 24), HudHeight - 100);
            HudPanel(rect, "#1b1520");
            GUILayout.BeginArea(new Rect(rect.x + 16, rect.y + 12, rect.width - 32, rect.height - 24));
            GUILayout.BeginHorizontal(); GUILayout.Label("装備図鑑・実績", SurvivorText(16)); if (SurvivorButton("libraryClose", "閉じる", null, GUILayout.Width(60))) survivorLibrary = false; GUILayout.EndHorizontal();
            survivorLibraryScroll.x = 0;
            survivorLibraryScroll = GUILayout.BeginScrollView(survivorLibraryScroll, false, true, GUIStyle.none, GUI.skin.verticalScrollbar);
            float contentWidth = rect.width - 56;
            GUILayout.BeginVertical(GUILayout.Width(contentWidth));
            GUILayout.Label($"プレイ {survivorProfile["runs"] ?? 0} 回 · 最高 Lv.{survivorProfile["bestLevel"] ?? 0} · 最高討伐 {survivorProfile["bestKills"] ?? 0}", SurvivorText(10));
            var discovered = (survivorProfile["discovered"] as JArray ?? new JArray()).Select(x => (string)x).ToArray();
            bool mythicFound = discovered.Any(id => (string)SurvivorCatalog["gear"]?[id]?["rarity"] == "mythic");
            var visible = ((JObject)SurvivorCatalog["gear"]).Properties().Where(g => (string)g.Value["rarity"] != "mythic" || mythicFound).ToArray();
            int count = visible.Length + (mythicFound ? 0 : 1);
            for (int i = 0; i < count; i += 2)
            {
                GUILayout.BeginHorizontal();
                for (int column = 0; column < 2 && i + column < count; column++)
                {
                    int index = i + column;
                    bool known = index < visible.Length && discovered.Contains(visible[index].Name);
                    GUILayout.BeginVertical(SurvivorCard(known ? "#382735" : "#251e2b"), GUILayout.Width((contentWidth - 18) / 2), GUILayout.MinHeight(118));
                    if (index < visible.Length)
                    {
                        var gear = visible[index];
                        GUILayout.Label((string)gear.Value["name"], SurvivorText(12));
                        GUILayout.Label(SurvivorRarity((string)gear.Value["rarity"]) + " · " + (known ? "発見済み" : "未獲得"), SurvivorText(9, "#dec9d6"));
                        GUILayout.Label(SurvivorGearInfo(gear.Name), SurvivorText(10, "#dec9d6"));
                    }
                    else GUILayout.Label("？？？\n未発見\n図鑑に載っていない装備", SurvivorText(12));
                    GUILayout.EndVertical();
                }
                GUILayout.EndHorizontal(); GUILayout.Space(6);
            }
            GUILayout.Label("実績", SurvivorText(14));
            foreach (var achievement in ((JObject)SurvivorCatalog["achievements"]).Properties())
                GUILayout.Label(((survivorProfile["achievements"] as JArray)?.Any(id => (string)id == achievement.Name) == true ? "✦ " : "◇ ") + (string)achievement.Value["name"] + " — " + (string)achievement.Value["desc"], SurvivorText(11));
            GUILayout.EndVertical(); GUILayout.EndScrollView(); GUILayout.EndArea();
            if (rect.Contains(Event.current.mousePosition) && Event.current.type == EventType.MouseDown) Event.current.Use();
        }
    }
}
