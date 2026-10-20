using System;
using System.Collections;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        ItemCameraCapture cameraCapture;
        float cameraFrameAt;

        ItemCameraCapture CameraCapture()
        {
            if (cameraCapture == null)
            {
                var root = new GameObject("Virtual camera capture"); root.transform.SetParent(transform, false);
                cameraCapture = root.AddComponent<ItemCameraCapture>();
            }
            return cameraCapture;
        }

        byte[] CaptureItemCamera(JObject item, int width, int height, int quality)
        {
            Vector3 position; Quaternion rotation;
            if ((string)item["holder"] == selfId) { position = eye.transform.position; rotation = eye.transform.rotation; }
            else { position = Position(item) + Vector3.up * 1.5f; rotation = Quaternion.Euler(-Float(item, "pitch") * Mathf.Rad2Deg, -Float(item, "ry") * Mathf.Rad2Deg, 0); }
            string id = (string)item["id"];
            itemObjects.TryGetValue(id, out var model);
            liveScreens.TryGetValue("camera:" + id, out var monitor);
            bool modelActive = model != null && model.activeSelf, monitorActive = monitor != null && monitor.activeSelf;
            try
            {
                // レンズ自身と手元のモニターが撮影結果に映り込まないようにする。
                if (modelActive) model.SetActive(false);
                if (monitorActive) monitor.SetActive(false);
                return CameraCapture().Render(eye, position, rotation, width, height, quality);
            }
            finally
            {
                if (modelActive && model != null) model.SetActive(true);
                if (monitorActive && monitor != null) monitor.SetActive(true);
            }
        }

        IEnumerator TakeItemPhoto(string id)
        {
            yield return new WaitForEndOfFrame();
            if (string.IsNullOrEmpty(id) || !items.TryGetValue(id, out var item) || (string)item["kind"] != "camera") yield break;
            try
            {
                var jpeg = CaptureItemCamera(item, 1280, 720, 85);
                Room(new { t = "chat", text = "📷 撮影しました", image = "data:image/jpeg;base64," + Convert.ToBase64String(jpeg), scope = "all" });
                notice = "写真をチャットに送りました";
            }
            catch (Exception error) { notice = "撮影できませんでした: " + error.Message; }
        }

        void UpdateCameraCapture()
        {
            if (!bridge.Connected || Time.unscaledTime < cameraFrameAt) return;
            cameraFrameAt = Time.unscaledTime + 1f / 15;
            var active = items.Values.Where(value => (string)value["kind"] == "camera" && (bool?)value["live"] == true && (string)value["operator"] == selfId).ToArray();
            foreach (var item in active) try
            {
                var jpeg = CaptureItemCamera(item, 640, 360, 75);
                string encoded = Convert.ToBase64String(jpeg), id = (string)item["id"];
                bridge.Send(new { t = "cameraFrame", id, jpeg = encoded });
                ReceiveVideo(new JObject { ["identity"] = "camera:" + id, ["jpeg"] = encoded });
            }
            catch (Exception error) { notice = "カメラ配信: " + error.Message; }
        }

        void DisposeCameraCapture() { if (cameraCapture != null) Destroy(cameraCapture.gameObject); cameraCapture = null; }
    }

    public sealed class ItemCameraCapture : MonoBehaviour
    {
        Camera camera;
        RenderTexture target;
        Texture2D pixels;
        public byte[] Render(Camera source, Vector3 position, Quaternion rotation, int width, int height, int quality)
        {
            if (camera == null) { camera = gameObject.AddComponent<Camera>(); camera.enabled = false; }
            if (target == null || target.width != width || target.height != height)
            {
                Release();
                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32); target.Create();
                pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
            }
            camera.CopyFrom(source); camera.enabled = false; camera.fieldOfView = 60; camera.aspect = width / (float)height;
            camera.transform.SetPositionAndRotation(position, rotation); camera.targetTexture = target;
            var previous = RenderTexture.active;
            try
            {
                camera.Render(); RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0, false); pixels.Apply(false, false);
                return pixels.EncodeToJPG(quality);
            }
            finally { RenderTexture.active = previous; camera.targetTexture = null; }
        }
        void Release()
        {
            if (target != null) { target.Release(); Destroy(target); target = null; }
            if (pixels != null) { Destroy(pixels); pixels = null; }
        }
        void OnDestroy() => Release();
    }
}
