using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed class AvatarParityProbe : MonoBehaviour
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        readonly Dictionary<string, bool> checks = new Dictionary<string, bool>();
        string output;
        Camera captureCamera;
        TonariumWorld world;

        IEnumerator Start()
        {
            yield return null;
            output = Path.Combine(Application.persistentDataPath, "avatar-parity");
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--tonarium-output") output = args[i + 1];
            Directory.CreateDirectory(output);
            world = GetComponent<TonariumWorld>(); world.enabled = false;
            captureCamera = (Camera)Field("eye"); captureCamera.fieldOfView = 48; captureCamera.nearClipPlane = .01f;
            captureCamera.backgroundColor = new Color(.91f, .88f, .83f);
            ((GameObject)Field("environment")).SetActive(false);
            var root = new GameObject("Avatar parity fixture");
            var modelObject = OekakiModel.Create(root.transform); var model = modelObject.GetComponent<OekakiModel>(); model.enabled = false;
            var identity = root.AddComponent<AvatarPresentation>(); identity.Initialize((Font)Field("font"));
            identity.SetIdentity("2D お絵描きアバター", true, false); identity.SetSpeech("Web版と同じモデル・同じ寸法です");
            Pose(model, 0);
            checks["original-textured-meshes"] = model.GetComponentsInChildren<MeshRenderer>().Length == 14;
            checks["web-model-scale"] = model.transform.localScale == Vector3.one * .012f;
            var head = model.GetComponentsInChildren<Transform>().First(t => t.name == "Head");
            var headAtZero = head.localPosition; Pose(model, 1.2f);
            checks["original-animation-moves-head"] = Vector3.Distance(headAtZero, head.localPosition) > .01f;
            var headFront = model.GetComponentsInChildren<Transform>().First(t => t.name == "Head_Front");
            checks["eye-default-web-parity"] = Mathf.Abs(model.CalculatedEyeHeight - 1.085556018447876f) < .000001f;
            checks["eye-before-load-default"] = Mathf.Abs(model.EyeHeight - OekakiModel.DefaultEyeHeight) < .000001f;
            model.ApplyParameters(new JObject { ["headSize"] = 100, ["neckLength"] = 80, ["legsDistanceFromBody"] = 70, ["legsSize"] = 3 });
            checks["eye-extreme-web-parity"] = Mathf.Abs(model.CalculatedEyeHeight - 3.926202306447876f) < .000001f;
            checks["eye-waits-for-texture-and-params"] = Mathf.Abs(model.EyeHeight - OekakiModel.DefaultEyeHeight) < .000001f;
            model.AppearanceReady = true;
            var provider = new EyeHeightProvider();
            provider.Update(model.EyeHeight, .2f);
            checks["eye-smooth-load-transition"] = provider.Current > OekakiModel.DefaultEyeHeight && provider.Current < model.EyeHeight;
            var highFrameRate = new EyeHeightProvider();
            var lowFrameRate = new EyeHeightProvider();
            for (int i = 0; i < 120; i++) highFrameRate.Update(model.EyeHeight, 1f / 120);
            for (int i = 0; i < 30; i++) lowFrameRate.Update(model.EyeHeight, 1f / 30);
            checks["eye-frame-rate-independent"] = Mathf.Abs(highFrameRate.Current - lowFrameRate.Current) < .00001f;
            checks["eye-top-view-offset"] = Mathf.Abs(OekakiModel.DefaultEyeHeight + (16 - OekakiModel.DefaultEyeHeight) - 16) < .000001f;
            Pose(model, 0);
            checks["eye-extreme-model-landmark"] = Mathf.Abs(root.transform.InverseTransformPoint(head.TransformPoint(model.EyeLandmark)).y - model.EyeHeight) < .12f;
            View(new Vector3(0, 2, 7), new Vector3(0, 2, 0));
            yield return Capture("avatar-extreme-eye-height.png");
            model.ApplyParameters(new JObject()); Pose(model, 0);
            checks["eye-standard-model-landmark"] = Mathf.Abs(root.transform.InverseTransformPoint(head.TransformPoint(model.EyeLandmark)).y - model.EyeHeight) < .12f;
            model.ApplyParameters(new JObject { ["headSize"] = -100, ["legsSize"] = -3, ["neckLength"] = -30, ["legsDistanceFromBody"] = 100 });
            checks["eye-inverted-web-parity"] = Mathf.Abs(model.CalculatedEyeHeight - 1.742880474447876f) < .000001f;
            model.ApplyParameters(new JObject());
            model.ApplyParameters(new JObject { ["headSize"] = 8, ["tailRotation"] = .25f }); Pose(model, 0);
            var first = headFront.localScale;
            model.ApplyParameters(new JObject { ["headSize"] = 8, ["tailRotation"] = .25f }); Pose(model, 0);
            checks["parameters-can-be-reapplied"] = Vector3.Distance(first, headFront.localScale) < .001f;
            model.ApplyParameters(new JObject()); Pose(model, 0);
            View(new Vector3(0, .85f, 3.5f), new Vector3(0, .85f, 0));
            yield return Capture("avatar-front.png");
            View(new Vector3(0, .85f, -3.5f), new Vector3(0, .85f, 0));
            yield return Capture("avatar-back.png");
            View(new Vector3(0, .85f, 3.5f), new Vector3(0, .85f, 0));
            var face = headFront.GetComponent<MeshRenderer>().sharedMaterial;
            face.mainTextureOffset = new Vector2(1f / 6, 0);
            yield return Capture("avatar-blink.png");
            face.mainTextureOffset = new Vector2(-1f / 6, 0); identity.SetIdentity("話しています", false, true);
            yield return Capture("avatar-speaking.png");
            face.mainTextureOffset = Vector2.zero; model.LookPitch = .65f;
            for (int i = 0; i < 32; i++) Pose(model, 1);
            yield return Capture("avatar-look-up.png");
            checks["face-material-independent"] = face != model.GetComponentsInChildren<MeshRenderer>().First(r => r.name == "Head_Back").sharedMaterial;
            root.SetActive(false);

            var users = new JArray(new JObject { ["id"] = "share", ["name"] = "配信テスト", ["session"] = "parity", ["mode"] = "3d", ["display"] = new JObject { ["x"] = 0, ["z"] = 0, ["ry"] = 0 } });
            SetField("users", users); SetField("sessionId", "parity");
            var texture = TestVideo();
            Invoke("ReceiveVideo", new JObject { ["identity"] = "share", ["jpeg"] = Convert.ToBase64String(texture.EncodeToJPG(95)) });
            for (int i = 0; i < 30; i++) { Invoke("UpdateVideoScreens"); yield return null; }
            var screens = (Dictionary<string, GameObject>)Field("liveScreens");
            var display = screens["share"];
            var front = display.transform.Find("Front"); var back = display.transform.Find("Back");
            checks["share-width-1.6-metres"] = Mathf.Abs(front.localScale.x - 1.6f) < .001f;
            checks["share-preserves-video-aspect"] = Mathf.Abs(front.localScale.x / front.localScale.y - 16f / 9) < .01f;
            checks["share-has-two-facing-surfaces"] = Quaternion.Angle(front.localRotation, back.localRotation) > 179;
            View(new Vector3(0, 1.7f, 3.5f), new Vector3(0, 1.35f, 0));
            yield return Capture("display-front.png");
            View(new Vector3(0, 1.7f, -3.5f), new Vector3(0, 1.35f, 0));
            yield return Capture("display-back.png");
            ((JObject)users[0])["mode"] = "2d";
            ((Dictionary<string, GameObject>)Field("avatars"))["share"] = root; root.transform.localScale = Vector3.one;
            Invoke("UpdateVideoScreens");
            checks["2d-share-width-0.9-metres"] = Mathf.Abs(front.localScale.x - .9f) < .001f;
            checks["2d-share-head-height"] = Mathf.Abs(display.transform.position.y - 1.55f) < .001f;
            View(new Vector3(0, 2, 3), new Vector3(0, 2, 0)); Invoke("UpdateVideoScreens");
            yield return Capture("display-2d-overhead.png");
            File.WriteAllText(Path.Combine(output, "result.json"), JsonConvert.SerializeObject(new { ok = checks.Values.All(v => v), checks }, Formatting.Indented));
            Debug.Log("TONARIUM_AVATAR_PARITY " + JsonConvert.SerializeObject(checks));
            Application.Quit(checks.Values.All(v => v) ? 0 : 1);
        }

        object Field(string name) => typeof(TonariumWorld).GetField(name, Private).GetValue(world);
        void SetField(string name, object value) => typeof(TonariumWorld).GetField(name, Private).SetValue(world, value);
        void Invoke(string name, object value) => typeof(TonariumWorld).GetMethod(name, Private).Invoke(world, new[] { value });
        void Invoke(string name) => typeof(TonariumWorld).GetMethod(name, Private).Invoke(world, null);
        static void Pose(OekakiModel model, float at) => typeof(OekakiModel).GetMethod("Pose", Private).Invoke(model, new object[] { at });
        void View(Vector3 position, Vector3 target) { captureCamera.transform.position = position; captureCamera.transform.LookAt(target); }

        IEnumerator Capture(string filename)
        {
            yield return null; yield return new WaitForEndOfFrame();
            var target = RenderTexture.GetTemporary(1200, 900, 24); var previous = RenderTexture.active;
            var image = new Texture2D(1200, 900, TextureFormat.RGB24, false);
            captureCamera.targetTexture = target; captureCamera.Render(); RenderTexture.active = target;
            image.ReadPixels(new Rect(0, 0, 1200, 900), 0, 0); image.Apply();
            File.WriteAllBytes(Path.Combine(output, filename), image.EncodeToPNG());
            captureCamera.targetTexture = null; RenderTexture.active = previous; RenderTexture.ReleaseTemporary(target); Destroy(image);
        }

        static Texture2D TestVideo()
        {
            var texture = new Texture2D(320, 180, TextureFormat.RGB24, false);
            for (int y = 0; y < 180; y++) for (int x = 0; x < 320; x++)
            {
                bool mark = x > 22 && x < 38 && y > 25 && y < 155 || x > 22 && x < 90 && y > 25 && y < 42;
                texture.SetPixel(x, y, mark ? Color.white : x < 160 ? new Color(.88f, .3f, .2f) : new Color(.2f, .45f, .85f));
            }
            texture.Apply(); return texture;
        }
    }
}
