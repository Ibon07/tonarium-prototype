using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        JObject survivor = new JObject(), survivorProfile = new JObject(), survivorCatalog;
        readonly Dictionary<string, GameObject> survivorEnemies = new Dictionary<string, GameObject>();
        readonly Dictionary<string, GameObject> survivorPeople = new Dictionary<string, GameObject>();
        readonly Dictionary<string, Material> survivorMaterials = new Dictionary<string, Material>();
        readonly List<GameObject> survivorEffects = new List<GameObject>();
        readonly HashSet<string> survivorEffectIds = new HashSet<string>();
        readonly Dictionary<string, Rect> survivorHudControls = new Dictionary<string, Rect>();
        GameObject survivorRoot;
        GameObject survivorLobbyMarker;
        Vector2 survivorScroll;
        bool survivorDetails, survivorLibrary, survivorResetConfirm;
        int survivorRun = -1;
        string survivorSession = "";
        JObject SurvivorMe => survivor["players"]?[selfId] as JObject;
        bool SurvivorActive => world == "survivors" && ((string)survivor["phase"] == "running" || (string)survivor["phase"] == "boss");
        bool SurvivorPaused => survivor["pausedAt"] != null && survivor["pausedAt"].Type != JTokenType.Null;
        public int SurvivorEnemyCount => survivorEnemies.Count;
        public int SurvivorPlayerCount => survivorPeople.Count;
        JObject SurvivorCatalog => survivorCatalog ?? (survivorCatalog = JObject.Parse(Resources.Load<TextAsset>("Web/SurvivorCatalog").text));
        string SurvivorName(string group, string id) => (string)SurvivorCatalog[group]?[id]?["name"] ?? id;
        static float SurvivorNumber(JToken token) => token == null || token.Type == JTokenType.Null ? 0 : (float)token;
        void ClearSurvivorScene()
        {
            if (survivorRoot != null) { survivorRoot.SetActive(false); Destroy(survivorRoot); }
            survivorRoot = null; survivorVisualActors.Clear(); survivorVisualAttacks.Clear(); survivorEnemies.Clear(); survivorPeople.Clear(); survivorEffects.Clear(); survivorEffectIds.Clear();
            survivorLobbyMarker = null; survivorHudControls.Clear(); survivorScroll = Vector2.zero;
            survivorDetails = survivorLibrary = survivorResetConfirm = false;
            survivorRun = -1; survivorSession = "";
            eye.transform.localPosition = new Vector3(0, 1.6f, 0);
            eye.transform.localRotation = Quaternion.Euler(pitch, 0, 0);
            foreach (var avatar in avatars.Values) avatar.SetActive(true);
        }
        void ApplySurvivor(JObject value)
        {
            survivor = value ?? new JObject();
            if (world != "survivors") return;
            var me = SurvivorMe;
            int nextRun = (int?)survivor["run"] ?? 0;
            if (me != null && (survivorRun != nextRun || survivorSession != sessionId))
            {
                foreach (var effect in survivorEffects) if (effect != null) Destroy(effect);
                survivorEffects.Clear(); survivorEffectIds.Clear();
                survivorRun = nextRun; survivorSession = sessionId;
                controller.enabled = false;
                controller.transform.position = new Vector3(Float(me, "x"), .05f, -Float(me, "z"));
                controller.enabled = true; yaw = 0; pitch = 0; vertical = 0;
                initialPosition = true;
            }
            SyncSurvivorMarkers(survivor["enemies"] as JArray ?? new JArray(), true);
            var people = new JArray();
            if (survivor["players"] is JObject players)
                foreach (var p in players.Properties()) { var item = (JObject)p.Value.DeepClone(); item["id"] = p.Name; people.Add(item); }
            SyncSurvivorMarkers(people, false);
            var effects = survivor["effects"] as JArray ?? new JArray();
            var live = new HashSet<string>(effects.OfType<JObject>().Select(e => (string)e["id"]));
            survivorEffectIds.IntersectWith(live);
            for(int i=survivorVisualAttacks.Count-1;i>=0;i--)
                if(!live.Contains(survivorVisualAttacks[i].id)) { Destroy(survivorVisualAttacks[i].root); survivorVisualAttacks.RemoveAt(i); }
            foreach (var effect in effects.OfType<JObject>())
            {
                string id = (string)effect["id"];
                if (string.IsNullOrEmpty(id) || !survivorEffectIds.Add(id) || Now - ((long?)effect["at"] ?? Now) > 650) continue;
                CreateSurvivorAttack(effect);
            }
            survivorEffects.RemoveAll(o => o == null);
        }
        void SyncSurvivorMarkers(JArray values, bool enemy)
        {
            var collection = enemy ? survivorEnemies : survivorPeople;
            var live = new HashSet<string>(); int index = 0;
            foreach (var value in values.OfType<JObject>())
            {
                string id = (string)value["id"]; if (string.IsNullOrEmpty(id)) continue;
                live.Add(id);
                if (!collection.TryGetValue(id, out var marker))
                    collection[id] = marker = CreateSurvivorActor(value, enemy, index);
                UpdateSurvivorActor(marker, value, enemy, index++);
            }
            foreach (var id in collection.Keys.Where(id => !live.Contains(id)).ToArray()) { survivorVisualActors.Remove(collection[id]); Destroy(collection[id]); collection.Remove(id); }
        }
        void UpdateSurvivor(bool controls)
        {
            if (world != "survivors") return;
            UpdateSurvivorVisuals();
            if (!SurvivorActive)
            {
                eye.transform.localPosition = new Vector3(0, 1.6f, 0);
                eye.transform.localRotation = Quaternion.Euler(pitch, 0, 0);
                return;
            }
            if (Cursor.lockState != CursorLockMode.None) Unlock();
            var me = SurvivorMe;
            controller.transform.rotation = Quaternion.identity;
            eye.transform.localPosition = new Vector3(0, 16, 0);
            eye.transform.localRotation = Quaternion.Euler(90, 0, 0);
            bool canMove = controls && Application.isFocused && (!SurvivorActive || (me != null && (bool?)me["alive"] == true && !SurvivorPaused));
            if (canMove)
            {
                var direction = new Vector3(Input.GetAxisRaw("Horizontal"), 0, Input.GetAxisRaw("Vertical"));
                float baseSpeed = (float)SurvivorCatalog["constants"]["moveSpeed"];
                float speed = me == null ? baseSpeed : (float?)SurvivorCatalog["styles"]?[(string)me["style"] ?? "bloodrose"]?["speed"] ?? baseSpeed;
                speed *= 1 + SurvivorNumber(survivorProfile["upgrades"]?["haste"]) * .03f;
                speed *= 1 + SurvivorNumber(me?["gear"]?["nightcloak"]) * .025f;
                controller.Move(Vector3.ClampMagnitude(direction, 1) * (speed * Mathf.Min(Time.deltaTime, .1f)));
                var p = controller.transform.position;
                controller.enabled = false;
                float limit = (float)SurvivorCatalog["constants"]["worldLimit"];
                controller.transform.position = new Vector3(Mathf.Clamp(p.x, -limit, limit), .05f, Mathf.Clamp(p.z, -limit, limit));
                controller.enabled = true;
            }
            if (survivorPeople.TryGetValue(selfId, out var self)) self.transform.position = new Vector3(controller.transform.position.x, 0, controller.transform.position.z);

        }
    }
}
