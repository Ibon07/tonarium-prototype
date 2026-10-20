using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Video;

namespace Tonarium.UnityClient
{
    public sealed class MediaPlaybackProbe : MonoBehaviour
    {
        string output, fixture;
        readonly List<string> checks = new List<string>();
        IEnumerator Start()
        {
            output = Path.Combine(Application.persistentDataPath, "media-playback");
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (args[i] == "--tonarium-output") output = args[i + 1];
                if (args[i] == "--video-fixture") fixture = args[i + 1];
            }
            Directory.CreateDirectory(output);
            var run = Run();
            while (true)
            {
                object next = null; Exception failure = null;
                try { if (!run.MoveNext()) break; next = run.Current; }
                catch (Exception error) { failure = error; }
                if (failure != null)
                {
                    File.WriteAllText(Path.Combine(output, "media-playback.json"), new JObject { ["ok"] = false, ["error"] = failure.ToString(), ["checks"] = new JArray(checks) }.ToString());
                    Debug.LogException(failure); Application.Quit(1); yield break;
                }
                yield return next;
            }
        }
        IEnumerator Run()
        {
            yield return null;
            if (string.IsNullOrEmpty(fixture) || !File.Exists(fixture)) throw new FileNotFoundException("Specify the red/blue four-second clip with --video-fixture.", fixture);
            var world = GetComponent<TonariumWorld>();
            var apply = typeof(TonariumWorld).GetMethod("ApplyItem", BindingFlags.NonPublic | BindingFlags.Instance);
            var item = new JObject { ["id"] = "media-playback-probe", ["kind"] = "video", ["url"] = new Uri(Path.GetFullPath(fixture)).AbsoluteUri, ["w"] = 16, ["h"] = 9, ["x"] = 0, ["z"] = -2, ["ry"] = 0 };
            Action<double, bool> clock = (position, playing) =>
            {
                var next = (JObject)item.DeepClone();
                next["clock"] = new JObject { ["base"] = position, ["playing"] = playing, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                apply.Invoke(world, new object[] { next }); item = next;
            };
            clock(.25, false);
            var root = GameObject.Find("Item media-playback-probe");
            var player = root.GetComponentInChildren<VideoPlayer>();
            var playback = root.GetComponentInChildren<ItemMediaPlayback>();
            float deadline = Time.realtimeSinceStartup + 15;
            while (!player.isPrepared && !playback.Failed && Time.realtimeSinceStartup < deadline) yield return null;
            if (!player.isPrepared || playback.Failed) throw new InvalidOperationException("Video fixture did not prepare.");
            checks.Add("H264動画をUnity VideoPlayerで読み込み");
            deadline = Time.realtimeSinceStartup + 4;
            while ((player.texture == null || Math.Abs(player.time - .25) > .12) && Time.realtimeSinceStartup < deadline) yield return null;
            if (player.texture == null || Math.Abs(player.time - .25) > .12) throw new InvalidOperationException("Initial paused seek failed: time=" + player.time + " frame=" + player.frame + " playing=" + player.isPlaying + " texture=" + (player.texture == null ? "null" : player.texture.width + "x" + player.texture.height));
            yield return new WaitForEndOfFrame();
            var red = ReadFrame(player.texture, Path.Combine(output, "red-frame.png"));
            if (red.r <= red.b + .25f) throw new InvalidOperationException("Expected a decoded red frame.");
            checks.Add("停止中の赤いフレームを実デコード");

            clock(.5, true); deadline = Time.realtimeSinceStartup + 4;
            while ((!player.isPlaying || player.time < .7) && Time.realtimeSinceStartup < deadline) yield return null;
            if (!player.isPlaying || player.time < .7) throw new InvalidOperationException("Video did not advance after play.");
            checks.Add("再生開始後に時刻が進む");
            clock(.9, false); deadline = Time.realtimeSinceStartup + 4;
            while ((player.isPlaying || Math.Abs(player.time - .9) > .08) && Time.realtimeSinceStartup < deadline) yield return null;
            if (player.isPlaying || Math.Abs(player.time - .9) > .08) throw new InvalidOperationException("Pause did not align to its clock.");
            double paused = player.time; yield return new WaitForSecondsRealtime(.25f);
            if (Math.Abs(player.time - paused) > .08) throw new InvalidOperationException("Paused playback advanced.");
            checks.Add("一時停止で指定位置に止まる");

            clock(1.15, false); deadline = Time.realtimeSinceStartup + 4;
            while (Math.Abs(player.time - 1.15) > .08 && Time.realtimeSinceStartup < deadline) yield return null;
            if (Math.Abs(player.time - 1.15) > .08) throw new InvalidOperationException("Paused 0.25-second seek was ignored.");
            checks.Add("停止中の0.25秒シークを反映");
            clock(2.5, false); deadline = Time.realtimeSinceStartup + 4;
            while (Math.Abs(player.time - 2.5) > .08 && Time.realtimeSinceStartup < deadline) yield return null;
            if (Math.Abs(player.time - 2.5) > .08) throw new InvalidOperationException("Blue-frame seek failed.");
            yield return new WaitForEndOfFrame();
            var blue = ReadFrame(player.texture, Path.Combine(output, "blue-frame.png"));
            if (blue.b <= blue.r + .25f) throw new InvalidOperationException("Expected a decoded blue frame.");
            checks.Add("シーク後に青いフレームへ変わる");
            if (GameObject.Find("Item media-playback-probe") != root || root.GetComponentInChildren<VideoPlayer>() != player) throw new InvalidOperationException("Clock updates replaced the player.");
            clock(3.65, true); deadline = Time.realtimeSinceStartup + 4;
            while ((!playback.Ended || player.isPlaying) && Time.realtimeSinceStartup < deadline) yield return null;
            if (!playback.Ended || player.isPlaying) throw new InvalidOperationException("Video did not stop at the end.");
            checks.Add("終端で停止し、全更新で同じプレイヤーを維持");
            File.WriteAllText(Path.Combine(output, "media-playback.json"), new JObject { ["ok"] = true, ["checks"] = new JArray(checks), ["duration"] = player.length, ["width"] = player.width, ["height"] = player.height, ["videoDecodeTested"] = true }.ToString());
            Debug.Log("TONARIUM_MEDIA_PLAYBACK_SUCCESS " + output); Application.Quit();
        }
        static Color ReadFrame(Texture source, string path)
        {
            var target = RenderTexture.GetTemporary(source.width, source.height, 0, RenderTextureFormat.ARGB32);
            var pixels = new Texture2D(source.width, source.height, TextureFormat.RGB24, false);
            var previous = RenderTexture.active;
            try
            {
                Graphics.Blit(source, target); RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, source.width, source.height), 0, 0); pixels.Apply(false, false);
                File.WriteAllBytes(path, pixels.EncodeToPNG()); return pixels.GetPixel(source.width / 2, source.height / 2);
            }
            finally { RenderTexture.active = previous; RenderTexture.ReleaseTemporary(target); Destroy(pixels); }
        }
    }
}
