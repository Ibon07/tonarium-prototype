using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    [DefaultExecutionOrder(32000)]
    public sealed class SurvivorBehaviorProbe : MonoBehaviour
    {
        string output;
        TonariumWorld world;
        float nextWrite;
        void Start()
        {
            var args = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(args, "--tonarium-output");
            if (index < 0 || index + 1 == args.Length) { enabled = false; return; }
            output = args[index + 1]; Directory.CreateDirectory(output);
            world = GetComponent<TonariumWorld>();
        }
        void LateUpdate()
        {
            if (Time.unscaledTime < nextWrite) return;
            nextWrite = Time.unscaledTime + .05f;
            var flags = BindingFlags.Instance | BindingFlags.NonPublic;
            object Field(string name) => typeof(TonariumWorld).GetField(name, flags).GetValue(world);
            JObject Vector(Vector3 p) => new JObject { ["x"] = p.x, ["y"] = p.y, ["z"] = p.z };
            var state = (JObject)Field("survivor");
            var controls = (Dictionary<string, Rect>)Field("survivorHudControls");
            var camera = (Camera)Field("eye");
            var people = (Dictionary<string, GameObject>)Field("survivorPeople");
            var enemies = (Dictionary<string, GameObject>)Field("survivorEnemies");
            var avatars = (Dictionary<string, GameObject>)Field("avatars");
            var markers = new JObject();
            foreach (var pair in people.Concat(enemies))
            {
                if (pair.Value == null) continue;
                var p = Vector(pair.Value.transform.position);
                p["active"] = pair.Value.activeInHierarchy;
                p["parts"] = new JArray(pair.Value.GetComponentsInChildren<MeshFilter>(true).Select(f => new JObject { ["name"] = f.name, ["mesh"] = f.sharedMesh.name, ["vertices"] = f.sharedMesh.vertexCount }));
                var screen = camera.WorldToScreenPoint(pair.Value.transform.position);
                p["screen"] = new JObject { ["x"] = screen.x, ["y"] = Screen.height - screen.y, ["depth"] = screen.z };
                markers[pair.Key] = p;
            }
            string commandPath = Path.Combine(output, "survivor-command.json");
            if (File.Exists(commandPath))
            {
                var command = JObject.Parse(File.ReadAllText(commandPath)); File.Delete(commandPath);
                if (command["visualNow"] != null) typeof(TonariumWorld).GetField("survivorVisualProbeNow", flags).SetValue(world, (long?)command["visualNow"]);
                if (command["capture"] != null) ScreenCapture.CaptureScreenshot(Path.Combine(output, Path.GetFileName((string)command["capture"])));
            }
            var json = new JObject {
                ["unity"] = Application.unityVersion, ["world"] = world.WorldKind, ["selfId"] = (string)Field("selfId"), ["sessionId"] = (string)Field("sessionId"),
                ["state"] = state.DeepClone(), ["profile"] = ((JObject)Field("survivorProfile")).DeepClone(),
                ["position"] = Vector(world.PlayerPosition), ["cameraLocalPosition"] = Vector(camera.transform.localPosition),
                ["cameraForward"] = Vector(camera.transform.forward), ["cursor"] = Cursor.lockState.ToString(), ["focused"] = Application.isFocused,
                ["menu"] = (bool)Field("menu"), ["chatOpen"] = (bool)Field("chatOpen"), ["selected"] = (string)Field("selected"),
                ["width"] = Screen.width, ["height"] = Screen.height, ["markers"] = markers,
                ["enemies"] = world.SurvivorEnemyCount, ["people"] = world.SurvivorPlayerCount,
                ["effects"] = ((List<GameObject>)Field("survivorEffects")).Count(effect => effect != null && effect.activeInHierarchy),
                ["visibleAvatars"] = avatars.Count(pair => pair.Value.activeInHierarchy),
                ["controls"] = new JObject(controls.Select(pair => new JProperty(pair.Key, new JObject { ["x"] = pair.Value.x, ["y"] = pair.Value.y, ["width"] = pair.Value.width, ["height"] = pair.Value.height }))),
            };
            string destination = Path.Combine(output, "survivor-state.json"), temporary = destination + ".tmp";
            File.WriteAllText(temporary, json.ToString());
            if (File.Exists(destination)) File.Replace(temporary, destination, null);
            else File.Move(temporary, destination);
        }
    }
}
