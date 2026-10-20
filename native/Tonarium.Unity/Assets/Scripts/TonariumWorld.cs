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
        bool menu, chatOpen, initialPosition, returnSent, embedded;
        float yaw, pitch, vertical, nextSend;
        Vector3 lastSentPosition = Vector3.positiveInfinity;
        float lastSentYaw, lastSentPitch;
        int lastSentJump;
        bool lastInputLocked;
        string canvasStroke, canvasItem;
        readonly List<float> canvasPoints = new List<float>();
        float canvasSendAt;
        Vector2 lastCanvasPoint;
        int jumps, round = -1, stepped = -1;
        Font font;
        GUIStyle labelStyle, titleStyle, bodyStyle, buttonStyle;
        Texture2D panelTexture;
        double serverOffset;
        public string WorldKind => world;
        public int AvatarCount => avatars.Count;
        public int ItemCount => items.Count;
        public int VideoScreenCount => liveScreens.Count;
        public Vector3 PlayerPosition => controller.transform.position;
        public bool IsBridgeConnected => bridge.Connected;

        void Awake()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 1;
            font = Resources.Load<Font>("Web/Fonts/ZenKakuGothicNew-Regular") ?? Font.CreateDynamicFontFromOSFont(new[] { "Yu Gothic UI", "Meiryo", "Segoe UI" }, 18);
            bridge = gameObject.AddComponent<DesktopBridge>();
            bridge.Message += Receive;
            var player = new GameObject("Player");
            controller = player.AddComponent<CharacterController>();
            controller.height = 1.6f; controller.center = Vector3.up * .8f;
            controller.radius = .3f; controller.stepOffset = .25f;
            player.transform.position = new Vector3(0, .05f, -6.5f);
            var cameraObject = new GameObject("View"); cameraObject.transform.SetParent(player.transform);
            cameraObject.transform.localPosition = new Vector3(0, 1.6f, 0);
            eye = cameraObject.AddComponent<Camera>(); eye.fieldOfView = 70; eye.nearClipPlane = .05f; eye.farClipPlane = 100;
            cameraObject.AddComponent<AudioListener>();
            yaw = 0;
            controller.transform.rotation = Quaternion.Euler(0, yaw, 0);
            BuildWorld("cafe");
            foreach (string arg in Environment.GetCommandLineArgs())
            {
                if (arg == "--tonarium-smoke") gameObject.AddComponent<SmokeCheck>();
                if (arg == "--tonarium-embedded") embedded = true;
                if (arg == "--tonarium-avatar-parity") gameObject.AddComponent<AvatarParityProbe>();
                if (arg == "--tonarium-item-parity") gameObject.AddComponent<ItemParityProbe>();
            }
        }

        void Receive(JObject m)
        {
            string type = (string)m["t"];
            if (type == "releaseInput") { EndCanvasStroke(); CommitNote(); selected = null; menu = false; Unlock(); return; }
            if (type == "videoFrame") { ReceiveVideo(m); return; }
            if (type == "resize")
            {
                uiScale=Mathf.Clamp((float?)m["scale"]??1,1,4);
                int width = Mathf.Clamp((int?)m["width"] ?? Screen.width, 160, 8192);
                int height = Mathf.Clamp((int?)m["height"] ?? Screen.height, 160, 8192);
                if (Screen.width != width || Screen.height != height)
                {
                    Debug.Log("TONARIUM_RESIZE " + Screen.width + "x" + Screen.height + " -> " + width + "x" + height);
                    Screen.SetResolution(width, height, FullScreenMode.Windowed);
                }
                return;
            }
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
                yaw = -Float(m, "ry") * Mathf.Rad2Deg; return;
            }
            if (type == "desktopDisconnected") { notice = "2D クライアントとの接続が切れました"; if(embedded)Application.Quit(); return; }
            if (type == "users") { users = m["list"] as JArray ?? users; SyncUsers(); }
            if (type == "presence") { presence = m["all"] as JObject ?? presence; SyncUsers(); }
            if (type == "avatar") ApplyAvatar((string)m["id"], m["s"] as JObject);
            if (type == "avatarRemove") RemoveAvatar((string)m["id"]);
            if (type == "item") ApplyItem(m["item"] as JObject);
            if (type == "itemRemove") RemoveItem((string)m["id"]);
            if (type == "chat") AddChat(m["m"] as JObject);
            if (type == "world") { initialPosition = false; BuildWorld((string)m["world"] ?? "room"); }
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
            RecordAvatarChat(m);
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
                    yaw = -Float(state, "ry") * Mathf.Rad2Deg;
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
            foreach (var id in avatars.Keys.ToArray()) if (!valid.Contains(id)) RemoveAvatar(id);
        }

        void CreateAvatar(string id)
        {
            var root = new GameObject("Avatar " + id);
            var user = users.OfType<JObject>().FirstOrDefault(u => (string)u["id"] == id);
            string name = (string)user?["name"] ?? id;
            root.transform.position = new Vector3((avatars.Count % 5 - 2) * .8f, 0, -6.5f);
            if(avatarStates.TryGetValue(id,out var initial)){root.transform.position=Position(initial);root.transform.rotation=Quaternion.Euler(0,-Float(initial,"ry")*Mathf.Rad2Deg,0);}
            var model = OekakiModel.Create(root.transform);
            avatars[id] = root;
            root.AddComponent<WorldTarget>().Id = "user:" + id;
            var collider = root.AddComponent<CapsuleCollider>(); collider.height = 1.3f; collider.center = Vector3.up * .65f; collider.radius = .35f;
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
                model.GetComponent<OekakiModel>().ApplyTexture(texture);
            }
            if (!string.IsNullOrEmpty(version))
                using (var request = UnityWebRequest.Get(serverUrl + "/avatar/params?name=" + UnityWebRequest.EscapeURL(name) + "&v=" + version))
                {
                    yield return request.SendWebRequest();
                    if (request.result == UnityWebRequest.Result.Success && model != null)
                    {
                        JObject parameters = null;
                        try { parameters = JObject.Parse(request.downloadHandler.text); } catch (Exception) { }
                        if (parameters != null) model.GetComponent<OekakiModel>().ApplyParameters(parameters);
                    }
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
                controller.enabled = false; controller.transform.position = ToUnity(TilePosition(tile)) + Vector3.up * .1f; controller.enabled = true;
            }
        }

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.Escape)) { EndCanvasStroke(); CommitNote(); selected = null; menu = false; Unlock(); }
            if (Input.GetKeyDown(KeyCode.F2)) ReturnTo2D();
            if (Input.GetKeyDown(KeyCode.Return) && !menu && selected == null)
            {
                if (embedded) { Unlock(); bridge.Send(new {t="focusChat"}); }
                else { chatOpen = !chatOpen; if (chatOpen) Unlock(); else SendChat(); }
            }
            if(selected!=null&&Input.GetMouseButtonDown(0))
            {
                var point=new Vector2(Input.mousePosition.x/uiScale,(Screen.height-Input.mousePosition.y)/uiScale);
                float width=Mathf.Min(480,HudWidth-32);
                if(!new Rect((HudWidth-width)/2,HudHeight-296,width,186).Contains(point)){CommitNote();selected=null;}
            }
            bool controls = !menu && !chatOpen && selected == null;
            bool justLocked = controls && Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked;
            if (justLocked) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
            if (controls && Cursor.lockState == CursorLockMode.Locked)
            {
                yaw += Input.GetAxisRaw("Mouse X") * 1.4324f; pitch = Mathf.Clamp(pitch - Input.GetAxisRaw("Mouse Y") * 1.4324f, -80.214f, 80.214f);
                controller.transform.rotation = Quaternion.Euler(0, yaw, 0); eye.transform.localRotation = Quaternion.Euler(pitch, 0, 0);
                var move = controller.transform.forward * Input.GetAxisRaw("Vertical") + controller.transform.right * Input.GetAxisRaw("Horizontal");
                move = Vector3.ClampMagnitude(move, 1) * 4;
                if (controller.isGrounded && vertical < 0) vertical = -2;
                if (controller.isGrounded && Input.GetKeyDown(KeyCode.Space)) { vertical = 4.2f; jumps++; }
                vertical -= 12 * Time.deltaTime;
                controller.Move((move + Vector3.up * vertical) * Time.deltaTime);
                if (Input.GetKeyDown(KeyCode.E) || (!justLocked && Input.GetMouseButtonDown(0))) Interact();
                if (canvasStroke != null && Input.GetMouseButton(0)) ContinueCanvasStroke();
                if (canvasStroke != null && Input.GetMouseButtonUp(0)) EndCanvasStroke();
                if (Input.GetMouseButtonDown(1)) ToggleCarry();
                if (Input.GetKeyDown(KeyCode.Q) && held != null) DropHeld();
                if (Input.GetKeyDown(KeyCode.C) && held != null && (string)items[held]["kind"] == "camera") StartCoroutine(TakePhoto());
                if (Input.GetKeyDown(KeyCode.L))
                {
                    string id=held;if(id==null&&Aim(out var cameraTarget))id=cameraTarget.Id;
                    if(id!=null&&items.TryGetValue(id,out var cam)&&(string)cam["kind"]=="camera")Room(new {t="itemAction",id,action=new {a="camLive",on=(bool?)cam["live"]!=true}});
                }
                if (Input.GetKeyDown(KeyCode.X) && Aim(out var target) && !target.Id.StartsWith("user:")) Room(new { t = "itemRemove", id = target.Id });
            }
            var currentPosition=controller.transform.position;
            if ((Time.time >= nextSend && ((currentPosition-lastSentPosition).sqrMagnitude>.0001f || Mathf.Abs(yaw-lastSentYaw)>.573f || Mathf.Abs(pitch-lastSentPitch)>1.719f)) || jumps!=lastSentJump)
            {
                nextSend = Time.time + .033f;
                var p = controller.transform.position;
                Room(new { t = "avatar", s = new { x = p.x, z = -p.z, y = p.y, ry = -yaw * Mathf.Deg2Rad, pitch = -pitch * Mathf.Deg2Rad, jump = jumps } });
                lastSentPosition=p;lastSentYaw=yaw;lastSentPitch=pitch;lastSentJump=jumps;
                if (carrying != null)
                {
                    var pos = controller.transform.position + controller.transform.forward * 2;
                    pos.y = 0;
                    if(itemObjects.TryGetValue(carrying,out var carried))carried.transform.position=pos;
                    SendCarry(pos);
                }
            }
            foreach (var pair in avatars)
                if (avatarStates.TryGetValue(pair.Key, out var state) && (string)users.OfType<JObject>().FirstOrDefault(u=>(string)u["id"]==pair.Key)?["mode"]!="2d")
                {
                    pair.Value.transform.position = Vector3.Lerp(pair.Value.transform.position, Position(state), Time.deltaTime * 15);
                    pair.Value.transform.rotation = Quaternion.Slerp(pair.Value.transform.rotation, Quaternion.Euler(0, -Float(state, "ry") * Mathf.Rad2Deg, 0), Time.deltaTime * 15);
                }
            UpdateAvatarPresentation();
            foreach (var pair in items)
            {
                string holder = (string)pair.Value["holder"];
                if (holder != null && itemObjects.TryGetValue(pair.Key, out var obj))
                {
                    var anchor = holder == selfId ? controller.transform : avatars.TryGetValue(holder, out var avatar) ? avatar.transform : null;
                    if (anchor != null)
                    {
                        bool firstPerson=holder==selfId;bool hammer=(string)pair.Value["kind"]=="hammer";
                        obj.transform.position = firstPerson ? eye.transform.TransformPoint(new Vector3(.26f,-.3f,.6f)) : anchor.TransformPoint(new Vector3(.32f,.6f,.1f));
                        obj.transform.rotation = firstPerson ? eye.transform.rotation*Quaternion.Euler(-17,0,8.6f) : anchor.rotation*Quaternion.Euler(-23,0,0);
                        obj.transform.localScale=Vector3.one*(firstPerson&&hammer?.38f:1);
                        foreach(var collider in obj.GetComponentsInChildren<Collider>())collider.enabled=!firstPerson;
                    }
                }
            }
            foreach (var pair in brokenTiles) if (pair.Value <= Now && tiles.TryGetValue(pair.Key, out var tile)) tile.SetActive(false);
            UpdateVideoScreens();
            bool locked=Cursor.lockState==CursorLockMode.Locked;
            if(locked!=lastInputLocked){lastInputLocked=locked;bridge.Send(new {t="inputState",locked});}
            if (world == "game" && (string)game["phase"] == "running")
            {
                if (controller.transform.position.y < -8)
                {
                    Room(new { t = "gameFell" }); controller.enabled = false; controller.transform.position = new Vector3(0, .1f, -6.5f); controller.enabled = true;
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
            if (!Physics.Raycast(eye.transform.position, eye.transform.forward, out var hit, 30)) return false;
            target = hit.collider.GetComponentInParent<WorldTarget>();
            return target != null;
        }
        int chessFrom = -1;
        void Interact()
        {
            if(carrying!=null){FinishCarry();return;}
            if(held!=null&&items.TryGetValue(held,out var heldItem)&&(string)heldItem["kind"]=="camera"){StartCoroutine(TakePhoto());return;}
            if (!Physics.Raycast(eye.transform.position, eye.transform.forward, out var hit, 30)) return;
            if (hit.collider.GetComponent<GameStart>() != null) { Room(new { t = "gameStart" }); return; }
            var target = hit.collider.GetComponentInParent<WorldTarget>(); if (target == null) return;
            if (target.Id.StartsWith("user:"))
            {
                if(held!=null && hit.distance<5)Room(new { t = "hit", to = target.Id.Substring(5) }); return;
            }
            if (!items.TryGetValue(target.Id, out var item)) return;
            if(TryCanvasPoint(hit,out var canvasId,out var point))
            {
                canvasItem=canvasId;canvasStroke=Guid.NewGuid().ToString();canvasSendAt=Time.unscaledTime;lastCanvasPoint=point;
                Room(new {t="itemAction",id=canvasId,action=new {a="strokeStart",id=canvasStroke,color=CanvasPenColor(canvasId),size=CanvasPenSize(canvasId),x=point.x,y=point.y}});
                return;
            }
            if(InteractItemSurface(target,hit))return;
            string kind = (string)item["kind"];
            if (kind == "hammer" || kind == "camera") { Room(new { t = "itemAction", id = target.Id, action = new { a = "pick" } }); return; }
            if (kind == "dice") { Room(new { t = "itemAction", id = target.Id, action = new { a = "diceRoll", sides = 6, count = 2, secret = false } }); return; }
            if ((kind == "chess" || kind == "chessAi") && hit.collider.GetComponent<ChessSquare>() is ChessSquare square)
            {
                if (chessFrom < 0) { chessFrom = square.Index; notice = "移動先のマスをクリック"; }
                else { Room(new { t = "itemAction", id = target.Id, action = new { a = "chessMove", from = chessFrom, to = square.Index, revision = (int?)item["chess"]?["revision"] ?? 0, promotion = "Q" } }); chessFrom = -1; }
                return;
            }
            selected = target.Id; noteDraft = (string)item["text"] ?? ""; noteSent = noteDraft; Unlock();
        }
        void ToggleCarry()
        {
            if (carrying != null) { FinishCarry(); return; }
            if (Aim(out var target))
            {
                if(target.Id.StartsWith("user:") && (string)users.OfType<JObject>().FirstOrDefault(u=>(string)u["id"]==target.Id.Substring(5))?["mode"]!="2d")return;
                carrying = target.Id;
                SendCarry(controller.transform.position+controller.transform.forward*2);
            }
        }
        void SendCarry(Vector3 position)
        {
            position.x=Mathf.Clamp(position.x,-9.5f,9.5f);position.z=Mathf.Clamp(position.z,-9.5f,9.5f);
            if(carrying.StartsWith("user:"))Room(new {t="place2d",target=carrying.Substring(5),pos=new{x=position.x,z=-position.z,ry=-yaw*Mathf.Deg2Rad+Mathf.PI}});
            else if(carrying.StartsWith("display:"))Room(new {t="displayMove",target=carrying.Substring(8),x=position.x,z=-position.z,ry=-yaw*Mathf.Deg2Rad});
            else Room(new{t="itemMove",id=carrying,x=position.x,z=-position.z,ry=-yaw*Mathf.Deg2Rad});
        }
        void FinishCarry(){if(carrying==null)return;SendCarry(controller.transform.position+controller.transform.forward*2);carrying=null;}

        void ContinueCanvasStroke()
        {
            if(!Physics.Raycast(eye.transform.position,eye.transform.forward,out var hit,30)||!TryCanvasPoint(hit,out var id,out var point)||id!=canvasItem)return;
            if(Vector2.Distance(lastCanvasPoint,point)<.5f)return;
            lastCanvasPoint=point;
            canvasPoints.Add(point.x);canvasPoints.Add(point.y);
            if(Time.unscaledTime-canvasSendAt>=.05f)FlushCanvasStroke();
        }
        void FlushCanvasStroke()
        {
            if(canvasStroke!=null&&canvasPoints.Count>0)Room(new{t="itemAction",id=canvasItem,action=new{a="strokeAdd",id=canvasStroke,pts=canvasPoints.ToArray()}});
            canvasPoints.Clear();canvasSendAt=Time.unscaledTime;
        }
        void EndCanvasStroke(){FlushCanvasStroke();canvasStroke=null;canvasItem=null;}
        void DropHeld()
        {
            var p = controller.transform.position + controller.transform.forward;
            Room(new { t = "itemAction", id = held, action = new { a = "drop", x = p.x, z = -p.z, ry = -yaw * Mathf.Deg2Rad, pitch = -pitch * Mathf.Deg2Rad } }); held = null;
        }
        void Room(object value) => bridge.Send(new { t = "room", message = value });
        void Unlock() { EndCanvasStroke();FinishCarry();Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
        void OnApplicationFocus(bool focused){if(!focused)Unlock();}
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
        static Vector3 ToUnity(Vector3 p) => new Vector3(p.x, p.y, -p.z);
        static Vector3 Position(JObject p) => ToUnity(new Vector3(Float(p, "x"), Float(p, "y"), Float(p, "z")));
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
