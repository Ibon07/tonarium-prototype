using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    public sealed partial class TonariumWorld
    {
        readonly Dictionary<string, GameObject> liveScreens = new Dictionary<string, GameObject>();
        readonly Dictionary<string, Texture2D> liveTextures = new Dictionary<string, Texture2D>();

        void ReceiveVideo(JObject message)
        {
            string identity = (string)message["identity"];
            string jpeg = (string)message["jpeg"];
            if (string.IsNullOrEmpty(identity)) return;
            if (string.IsNullOrEmpty(jpeg))
            {
                if (liveScreens.TryGetValue(identity, out var screen)) Destroy(screen);
                if (liveTextures.TryGetValue(identity, out var texture)) Destroy(texture);
                liveScreens.Remove(identity); liveTextures.Remove(identity); return;
            }
            if (!liveScreens.TryGetValue(identity, out var surface))
            {
                surface = Box(transform, "Live screen " + identity, Vector3.up * 2, new Vector3(2.4f, 1.35f, .035f), "#ffffff");
                Destroy(surface.GetComponent<Collider>());
                surface.GetComponent<Renderer>().material = new Material(Shader.Find("Unlit/Texture"));
                liveScreens[identity] = surface;
                liveTextures[identity] = new Texture2D(2, 2, TextureFormat.RGB24, false);
                surface.GetComponent<Renderer>().material.mainTexture = liveTextures[identity];
            }
            try { liveTextures[identity].LoadImage(Convert.FromBase64String(jpeg)); }
            catch (FormatException) { }
        }

        void UpdateVideoScreens()
        {
            foreach (var pair in liveScreens)
            {
                if (pair.Key.StartsWith("camera:"))
                {
                    if (itemObjects.TryGetValue(pair.Key.Substring(7), out var camera))
                    { pair.Value.transform.position = camera.transform.position + Vector3.up * 2; pair.Value.transform.rotation = camera.transform.rotation; }
                    continue;
                }
                if (presence[pair.Key]?["display"] is JObject display)
                {
                    pair.Value.transform.position = Position(display) + Vector3.up * 1.6f;
                    pair.Value.transform.rotation = Quaternion.Euler(0, -Float(display, "ry") * Mathf.Rad2Deg, 0);
                }
                else if (avatarStates.TryGetValue(pair.Key, out var state))
                {
                    pair.Value.transform.position = Position(state) + Vector3.up * 2.4f;
                    pair.Value.transform.rotation = Quaternion.LookRotation(eye.transform.position - pair.Value.transform.position);
                }
            }
        }
    }
}
