using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.Video;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld : MonoBehaviour
    {
        DesktopBridge bridge;
        Camera eye;
        CharacterController controller;
        GameObject environment;
        readonly Dictionary<string, GameObject> avatars = new Dictionary<string, GameObject>();
        readonly Dictionary<string, JObject> avatarStates = new Dictionary<string, JObject>();
        readonly Dictionary<string, GameObject> itemObjects = new Dictionary<string, GameObject>();
        readonly Dictionary<string, JObject> items = new Dictionary<string, JObject>();
        readonly Dictionary<int, GameObject> tiles = new Dictionary<int, GameObject>();
        readonly Dictionary<int, long> brokenTiles = new Dictionary<int, long>();
        readonly List<string> chat = new List<string>();
        JArray users = new JArray();
        JObject presence = new JObject();
        JObject game = new JObject();
        string selfId = "preview", sessionId = "", playerName = "あなた", world = "", serverUrl = "http://localhost:3000";
        string selected, carrying, held, draft = "", noteDraft = "", notice = "";
        bool menu, chatOpen, initialPosition, returnSent;
        float yaw, pitch, vertical, nextSend;
        int jumps, round = -1, stepped = -1;
        Font font;
        GUIStyle labelStyle, titleStyle, bodyStyle, buttonStyle;
        Texture2D panelTexture;
        double serverOffset;
        public string WorldKind => world;
        public int AvatarCount => avatars.Count;
        public int ItemCount => items.Count;
        public Vector3 PlayerPosition => controller.transform.position;
        public bool IsBridgeConnected => bridge.Connected;

        void Awake()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 1;
            font = Font.CreateDynamicFontFromOSFont(new[] { "Yu Gothic UI", "Meiryo", "Segoe UI" }, 18);
            bridge = gameObject.AddComponent<DesktopBridge>();
            bridge.Message += Receive;
            var player = new GameObject("Player");
            controller = player.AddComponent<CharacterController>();
            controller.height = 1.65f; controller.center = Vector3.up * .825f;
            controller.radius = .28f; controller.stepOffset = .25f;
            player.transform.position = new Vector3(0, .05f, 6.5f);
            var cameraObject = new GameObject("View"); cameraObject.transform.SetParent(player.transform);
            cameraObject.transform.localPosition = new Vector3(0, 1.55f, 0);
            eye = cameraObject.AddComponent<Camera>(); eye.fieldOfView = 70; eye.nearClipPlane = .05f; eye.farClipPlane = 150;
            cameraObject.AddComponent<AudioListener>();
            yaw = 180;
            controller.transform.rotation = Quaternion.Euler(0, yaw, 0);
            BuildWorld("cafe");
            foreach (string arg in Environment.GetCommandLineArgs())
                if (arg == "--tonarium-smoke") gameObject.AddComponent<SmokeCheck>();
        }

        void Receive(JObject m)
        {
            string type = (string)m["t"];
            if (type == "snapshot")
            {
                selfId = (string)m["selfId"] ?? selfId; playerName = (string)m["name"] ?? playerName;
                sessionId = (string)m["sessionId"] ?? sessionId;
                serverUrl = ((string)m["serverUrl"] ?? serverUrl).TrimEnd('/');
                users = m["users"] as JArray ?? new JArray(); presence = m["presence"] as JObject ?? new JObject();
                if (m["now"] != null) serverOffset = (double)m["now"] - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                BuildWorld((string)m["world"] ?? "room");
                if (m["avatars"] is JObject initialAvatars)
                    foreach (var prop in initialAvatars.Properties()) ApplyAvatar(prop.Name, prop.Value as JObject);
                if (m["items"] is JObject itemMap)
                    foreach (var prop in itemMap.Properties()) ApplyItem(prop.Value as JObject);
                else if (m["items"] is JArray itemList)
                    foreach (var item in itemList.OfType<JObject>()) ApplyItem(item);
                chat.Clear();
                if (m["chats"] is JArray chats)
                    foreach (var c in chats.OfType<JObject>()) AddChat(c);
                ApplyGame(m["game"] as JObject);
                SyncUsers();
                return;
            }
            if (type == "shutdown") { ReturnTo2D(); Application.Quit(); return; }
            if (type == "teleport")
            {
                controller.enabled = false; controller.transform.position = Position(m) + Vector3.up * .05f; controller.enabled = true;
                yaw = 180 - Float(m, "ry") * Mathf.Rad2Deg; return;
            }
            if (type == "desktopDisconnected") { notice = "2D クライアントとの接続が切れました"; return; }
            if (type == "users") { users = m["list"] as JArray ?? users; SyncUsers(); }
            if (type == "presence") { presence = m["all"] as JObject ?? presence; SyncUsers(); }
            if (type == "avatar") ApplyAvatar((string)m["id"], m["s"] as JObject);
            if (type == "avatarRemove") RemoveAvatar((string)m["id"]);
            if (type == "item") ApplyItem(m["item"] as JObject);
            if (type == "itemRemove") RemoveItem((string)m["id"]);
            if (type == "chat") AddChat(m["m"] as JObject);
            if (type == "world") BuildWorld((string)m["world"] ?? "room");
            if (type == "worldPending") notice = "ワールドを切り替えます…";
            if (type == "game") ApplyGame(m["game"] as JObject);
            if (type == "gameTile") brokenTiles[(int)m["tile"]] = (long)m["at"];
            if (type == "itemAction") ApplyDelta(m);
        }

        void ApplyDelta(JObject message)
        {
            var id = (string)message["id"];
            if (id == null || !items.TryGetValue(id, out var item)) return;
            var a = message["action"] as JObject;
            if ((string)a?["a"] == "canvasClear") item["strokes"] = new JArray();
            if ((string)a?["a"] == "strokeStart")
            {
                if (!(item["strokes"] is JArray)) item["strokes"] = new JArray();
                ((JArray)item["strokes"]).Add(new JObject { ["id"] = a["id"], ["color"] = a["color"], ["size"] = a["size"], ["pts"] = new JArray(a["x"], a["y"]) });
            }
            if ((string)a?["a"] == "strokeAdd" && item["strokes"] is JArray strokes)
            {
                var stroke = strokes.OfType<JObject>().FirstOrDefault(s => (string)s["id"] == (string)a["id"]);
                if (stroke?["pts"] is JArray points && a["pts"] is JArray incoming)
                    foreach (var p in incoming) points.Add(p.DeepClone());
            }
            ApplyItem(item);
        }

        void AddChat(JObject m)
        {
            if (m == null) return;
            chat.Add(((string)m["fromName"] ?? "お知らせ") + "  " + (string)m["text"]);
            if (chat.Count > 50) chat.RemoveAt(0);
        }

        void ApplyAvatar(string id, JObject state)
        {
            if (string.IsNullOrEmpty(id) || state == null) return;
            avatarStates[id] = state;
            if (id == selfId)
            {
                if (!initialPosition)
                {
                    controller.enabled = false;
                    controller.transform.position = Position(state) + Vector3.up * .05f;
                    controller.enabled = true;
                    yaw = 180 - Float(state, "ry") * Mathf.Rad2Deg;
                    initialPosition = true;
                }
                return;
            }
            if (!avatars.ContainsKey(id)) CreateAvatar(id);
        }

        void SyncUsers()
        {
            var valid = new HashSet<string>();
            foreach (var user in users.OfType<JObject>())
            {
                var id = (string)user["id"];
                if (string.IsNullOrEmpty(id) || id == selfId || (string)user["session"] != sessionId) continue;
                valid.Add(id);
                if (!avatars.ContainsKey(id)) CreateAvatar(id);
                var text = avatars[id].GetComponentInChildren<TextMesh>();
                if (text != null) text.text = (string)user["name"] + ((string)user["mode"] == "2d" ? " · 2D" : "");
                var pos = presence[id]?["pos"] as JObject;
                if ((string)user["mode"] == "2d" && pos != null) avatarStates[id] = pos;
            }
            foreach (var id in avatars.Keys.ToArray()) if (!valid.Contains(id) && !avatarStates.ContainsKey(id)) RemoveAvatar(id);
        }

        void CreateAvatar(string id)
        {
            var root = new GameObject("Avatar " + id);
            var user = users.OfType<JObject>().FirstOrDefault(u => (string)u["id"] == id);
            string name = (string)user?["name"] ?? id;
            root.transform.position = new Vector3((avatars.Count % 5 - 2) * .8f, 0, 6.5f);
            var model = OekakiModel.Create(root.transform);
            var face = Label(root.transform, name, new Vector3(0, 2, 0), .055f);
            face.gameObject.AddComponent<FaceCamera>();
            avatars[id] = root;
            root.AddComponent<WorldTarget>().Id = "user:" + id;
            var collider = root.AddComponent<CapsuleCollider>(); collider.height = 1.7f; collider.center = Vector3.up * .85f; collider.radius = .35f;
            StartCoroutine(LoadAvatar(model, name, (string)user?["avatar"]));
        }

        IEnumerator LoadAvatar(GameObject model, string name, string version)
        {
            string url = serverUrl + (string.IsNullOrEmpty(version) ? "/oekaki/sample.png" : "/avatar?name=" + UnityWebRequest.EscapeURL(name) + "&v=" + version);
            using (var request = UnityWebRequestTexture.GetTexture(url))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success || model == null) yield break;
                var texture = DownloadHandlerTexture.GetContent(request);
                foreach (var r in model.GetComponentsInChildren<MeshRenderer>())
                    if (r.gameObject.name.EndsWith("Front") || r.gameObject.name.EndsWith("Back"))
                    { r.material.mainTexture = texture; r.material.color = Color.white; }
            }
        }

        void RemoveAvatar(string id)
        {
            if (id == null) return;
            if (avatars.TryGetValue(id, out var avatar)) Destroy(avatar);
            avatars.Remove(id); avatarStates.Remove(id);
        }

        void ApplyGame(JObject value)
        {
            if (value == null) return;
            game = value;
            if (value["tiles"] is JObject tileMap) foreach (var t in tileMap.Properties()) if (int.TryParse(t.Name, out int n)) brokenTiles[n] = (long)t.Value;
            int newRound = (int?)value["round"] ?? 0;
            var players = value["players"] as JArray;
            int index = players == null ? -1 : players.ToList().FindIndex(p => (string)p["id"] == selfId);
            if (newRound != round && (string)value["phase"] == "running" && index >= 0)
            {
                round = newRound; stepped = -1; brokenTiles.Clear();
                foreach (var t in tiles.Values) t.SetActive(true);
                int tile = (index * 27 + 9) % 64;
                controller.enabled = false; controller.transform.position = TilePosition(tile) + Vector3.up * .1f; controller.enabled = true;
            }
        }

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.Escape)) { menu = !menu; Unlock(); }
            if (Input.GetKeyDown(KeyCode.F2)) ReturnTo2D();
            if (Input.GetKeyDown(KeyCode.Return) && !menu) { chatOpen = !chatOpen; if (chatOpen) Unlock(); else SendChat(); }
            bool controls = !menu && !chatOpen && selected == null;
            bool justLocked = controls && Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked;
            if (justLocked) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
            if (controls && Cursor.lockState == CursorLockMode.Locked)
            {
                yaw += Input.GetAxis("Mouse X") * 2.2f; pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * 2.2f, -80, 80);
                controller.transform.rotation = Quaternion.Euler(0, yaw, 0); eye.transform.localRotation = Quaternion.Euler(pitch, 0, 0);
                var move = controller.transform.forward * Input.GetAxisRaw("Vertical") + controller.transform.right * Input.GetAxisRaw("Horizontal");
                move = Vector3.ClampMagnitude(move, 1) * (Input.GetKey(KeyCode.LeftShift) ? 6.5f : 4);
                if (controller.isGrounded && vertical < 0) vertical = -2;
                if (controller.isGrounded && Input.GetKeyDown(KeyCode.Space)) { vertical = 4.2f; jumps++; }
                vertical -= 12 * Time.deltaTime;
                controller.Move((move + Vector3.up * vertical) * Time.deltaTime);
                if (Input.GetKeyDown(KeyCode.E) || (!justLocked && Input.GetMouseButtonDown(0))) Interact();
                if (Input.GetMouseButtonDown(1)) ToggleCarry();
                if (Input.GetKeyDown(KeyCode.Q) && held != null) DropHeld();
                if (Input.GetKeyDown(KeyCode.C) && held != null && (string)items[held]["kind"] == "camera") StartCoroutine(TakePhoto());
                if (Input.GetKeyDown(KeyCode.X) && Aim(out var target) && !target.Id.StartsWith("user:")) Room(new { t = "itemRemove", id = target.Id });
            }
            if (Time.time >= nextSend)
            {
                nextSend = Time.time + .06f;
                var p = controller.transform.position;
                Room(new { t = "avatar", s = new { x = p.x, z = p.z, y = p.y, ry = (180 - yaw) * Mathf.Deg2Rad, pitch = -pitch * Mathf.Deg2Rad, jump = jumps } });
                if (carrying != null && itemObjects.TryGetValue(carrying, out var carried))
                {
                    var pos = controller.transform.position + controller.transform.forward * 2;
                    pos.y = 0; carried.transform.position = pos;
                    Room(new { t = "itemMove", id = carrying, x = pos.x, z = pos.z, ry = (180 - yaw) * Mathf.Deg2Rad });
                }
            }
            foreach (var pair in avatars)
                if (avatarStates.TryGetValue(pair.Key, out var state))
                {
                    pair.Value.transform.position = Vector3.Lerp(pair.Value.transform.position, Position(state), Time.deltaTime * 15);
                    pair.Value.transform.rotation = Quaternion.Slerp(pair.Value.transform.rotation, Quaternion.Euler(0, 180 - Float(state, "ry") * Mathf.Rad2Deg, 0), Time.deltaTime * 15);
                }
            foreach (var pair in items)
            {
                string holder = (string)pair.Value["holder"];
                if (holder != null && itemObjects.TryGetValue(pair.Key, out var obj))
                {
                    var anchor = holder == selfId ? controller.transform : avatars.TryGetValue(holder, out var avatar) ? avatar.transform : null;
                    if (anchor != null) { obj.transform.position = anchor.position + anchor.right * .4f + anchor.forward * .5f; obj.transform.rotation = anchor.rotation; }
                }
            }
            foreach (var pair in brokenTiles) if (pair.Value <= Now && tiles.TryGetValue(pair.Key, out var tile)) tile.SetActive(false);
            if (world == "game" && (string)game["phase"] == "running")
            {
                if (controller.transform.position.y < -8)
                {
                    Room(new { t = "gameFell" }); controller.enabled = false; controller.transform.position = new Vector3(0, .1f, 6.5f); controller.enabled = true;
                }
                else if (Physics.Raycast(controller.transform.position + Vector3.up * .1f, Vector3.down, out var hit, .3f))
                {
                    var tile = hit.collider.GetComponent<GameTile>();
                    if (tile != null && tile.Index != stepped) { stepped = tile.Index; Room(new { t = "gameStep", tile = tile.Index }); }
                }
            }
        }

        bool Aim(out WorldTarget target)
        {
            target = null;
            if (!Physics.Raycast(eye.transform.position, eye.transform.forward, out var hit, 4)) return false;
            target = hit.collider.GetComponentInParent<WorldTarget>();
            return target != null;
        }
        int chessFrom = -1;
        void Interact()
        {
            if (!Physics.Raycast(eye.transform.position, eye.transform.forward, out var hit, 4)) return;
            if (hit.collider.GetComponent<GameStart>() != null) { Room(new { t = "gameStart" }); return; }
            var target = hit.collider.GetComponentInParent<WorldTarget>(); if (target == null) return;
            if (target.Id.StartsWith("user:"))
            {
                Room(held != null ? (object)new { t = "hit", to = target.Id.Substring(5) } : new { t = "poke", to = target.Id.Substring(5) }); return;
            }
            if (!items.TryGetValue(target.Id, out var item)) return;
            string kind = (string)item["kind"];
            if (kind == "hammer" || kind == "camera") { Room(new { t = "itemAction", id = target.Id, action = new { a = "pick" } }); return; }
            if (kind == "dice") { Room(new { t = "itemAction", id = target.Id, action = new { a = "diceRoll", sides = 6, count = 2, secret = false } }); return; }
            if ((kind == "chess" || kind == "chessAi") && hit.collider.GetComponent<ChessSquare>() is ChessSquare square)
            {
                if (chessFrom < 0) { chessFrom = square.Index; notice = "移動先のマスをクリック"; }
                else { Room(new { t = "itemAction", id = target.Id, action = new { a = "chessMove", from = chessFrom, to = square.Index, revision = (int?)item["chess"]?["revision"] ?? 0, promotion = "Q" } }); chessFrom = -1; }
                return;
            }
            selected = target.Id; noteDraft = (string)item["text"] ?? ""; Unlock();
        }
        void ToggleCarry()
        {
            if (carrying != null) { carrying = null; return; }
            if (Aim(out var target) && !target.Id.StartsWith("user:")) carrying = target.Id;
        }
        void DropHeld()
        {
            var p = controller.transform.position + controller.transform.forward;
            Room(new { t = "itemAction", id = held, action = new { a = "drop", x = p.x, z = p.z, ry = (180 - yaw) * Mathf.Deg2Rad, pitch = -pitch * Mathf.Deg2Rad } }); held = null;
        }
        void Room(object value) => bridge.Send(new { t = "room", message = value });
        void Unlock() { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
        void SendChat() { if (!string.IsNullOrWhiteSpace(draft)) Room(new { t = "chat", text = draft, scope = "all" }); draft = ""; }
        IEnumerator TakePhoto()
        {
            yield return new WaitForEndOfFrame();
            var target = RenderTexture.GetTemporary(1280, 720, 24);
            var previous = RenderTexture.active;
            var previousTarget = eye.targetTexture;
            var texture = new Texture2D(1280, 720, TextureFormat.RGB24, false);
            try
            {
                eye.targetTexture = target; eye.Render(); RenderTexture.active = target;
                texture.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0); texture.Apply();
                Room(new { t = "chat", text = "写真を撮りました", image = "data:image/jpeg;base64," + Convert.ToBase64String(texture.EncodeToJPG(82)), scope = "all" });
                notice = "写真をチャットに送りました";
            }
            finally { eye.targetTexture = previousTarget; RenderTexture.active = previous; RenderTexture.ReleaseTemporary(target); Destroy(texture); }
        }
        public void ReturnTo2D() { if (returnSent) return; returnSent = true; Unlock(); bridge.Send(new { t = "return2d" }); if (!bridge.Connected) Application.Quit(); }
        void OnApplicationQuit() { ReturnTo2D(); }
        long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + (long)serverOffset;
        static Vector3 Position(JObject p) => new Vector3(Float(p, "x"), Float(p, "y"), Float(p, "z"));
        static float Float(JObject o, string key, float fallback = 0) => (float?)o?[key] ?? fallback;
    }
    public sealed class WorldTarget : MonoBehaviour { public string Id; }
    public sealed class ChessSquare : MonoBehaviour { public int Index; }
    public sealed class GameTile : MonoBehaviour { public int Index; }
    public sealed class GameStart : MonoBehaviour { }
    public sealed class FaceCamera : MonoBehaviour
    {
        void LateUpdate()
        {
            if (Camera.allCameras.Length > 0) transform.rotation = Quaternion.LookRotation(transform.position - Camera.allCameras[0].transform.position);
        }
    }
}
