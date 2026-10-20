using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Tonarium.UnityClient
{
    // デスクトップからの受信と同じ経路で、描画時間と結果を検証する。
    public sealed class CanvasPerformanceProbe : MonoBehaviour
    {
        const string ItemId = "canvas-performance-probe";
        string output;
        readonly List<string> checks = new List<string>();
        TonariumWorld world;
        MethodInfo receive, paint;
        readonly object[] receiveArgs = new object[1];
        ItemPanelSurface surface;
        Texture2D originalTexture;
        GameObject originalRoot;
        JObject item;

        IEnumerator Start()
        {
            output = Path.Combine(Application.persistentDataPath, "canvas-perf");
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--tonarium-output") output = args[i + 1];
            Directory.CreateDirectory(output);
            IEnumerator run = Run();
            while (true)
            {
                object current = null;
                Exception failure = null;
                try { if (!run.MoveNext()) break; current = run.Current; }
                catch (Exception error) { failure = error; }
                if (failure != null)
                {
                    File.WriteAllText(Path.Combine(output, "canvas-perf.json"), new JObject { ["ok"] = false, ["error"] = failure.ToString(), ["checks"] = new JArray(checks) }.ToString());
                    UnityEngine.Debug.LogException(failure); Application.Quit(1); yield break;
                }
                yield return current;
            }
        }

        IEnumerator Run()
        {
            yield return null;
            world = GetComponent<TonariumWorld>();
            var flags = BindingFlags.NonPublic | BindingFlags.Instance;
            receive = typeof(TonariumWorld).GetMethod("Receive", flags);
            paint = typeof(TonariumWorld).GetMethod("PaintStrokes", BindingFlags.NonPublic | BindingFlags.Static);
            var strokes = new JArray();
            for (int s = 0; s < 32; s++)
            {
                var points = new JArray();
                for (int p = 0; p < 80; p++)
                {
                    points.Add(25 + p * 6.5f);
                    points.Add(30 + s * 11 + Mathf.Sin(p * .23f + s) * 12);
                }
                strokes.Add(new JObject { ["id"] = "history-" + s, ["color"] = s % 7 == 6 ? "erase" : s % 2 == 0 ? "#ef4444" : "#3b82f6", ["size"] = s % 7 == 6 ? 14 : 5, ["pts"] = points });
            }
            item = new JObject { ["id"] = ItemId, ["kind"] = "canvas", ["x"] = 0, ["z"] = -2, ["ry"] = 0, ["strokes"] = strokes };
            typeof(TonariumWorld).GetMethod("ApplyItem", flags).Invoke(world, new object[] { item });
            originalRoot = GameObject.Find("Item " + ItemId);
            surface = originalRoot.GetComponentInChildren<ItemPanelSurface>();
            originalTexture = surface.Texture;
            Flush(); Verify("history");
            Send(StartStroke("active", "#22c55e", 4, 35, 210)); Flush();
            yield return null;

            var allocatedMethod = typeof(GC).GetMethod("GetAllocatedBytesForCurrentThread", BindingFlags.Public | BindingFlags.Static);
            var allocated = allocatedMethod == null ? null : (Func<long>)Delegate.CreateDelegate(typeof(Func<long>), allocatedMethod);
            var costs = new List<double>(); var receives = new List<double>(); var frames = new List<double>(); var bytes = new List<long>();
            for (int b = 0; b < 120; b++)
            {
                var pts = new JArray();
                for (int p = 0; p < 3; p++) { int n = b * 3 + p + 1; pts.Add(35 + n * 1.45f); pts.Add(210 + Mathf.Sin(n * .12f) * 28); }
                var action = new JObject { ["a"] = "strokeAdd", ["id"] = "active", ["pts"] = pts };
                receiveArgs[0] = Message(action);
                long beforeBytes = allocated == null ? 0 : allocated();
                long begin = Stopwatch.GetTimestamp();
                receive.Invoke(world, receiveArgs);
                long received = Stopwatch.GetTimestamp();
                Flush();
                long end = Stopwatch.GetTimestamp();
                if (allocated != null) bytes.Add(allocated() - beforeBytes);
                receives.Add(Milliseconds(received - begin)); costs.Add(Milliseconds(end - begin));
                yield return null;
                frames.Add(Milliseconds(Stopwatch.GetTimestamp() - begin));
            }
            Verify("history-and-120-appends");
            File.WriteAllBytes(Path.Combine(output, "canvas-history.png"), surface.Texture.EncodeToPNG());

            Send(new JObject { ["a"] = "canvasClear" }); Flush(); Verify("clear");
            if (surface.Texture.GetPixel(110, 519 - 208).r < .99f) throw new InvalidOperationException("Clear retained a painted pixel.");
            Send(StartStroke("red", "#ef4444", 15, 100, 150)); Flush(); Verify("start");
            Send(Add("red", 150, 150, 200, 150)); Flush(); Verify("append");
            Send(StartStroke("eraser", "erase", 20, 150, 140));
            Send(Add("eraser", 150, 160)); Flush(); Verify("overlapping-eraser");
            if (surface.Texture.GetPixel(160, 519 - 208).r < .99f) throw new InvalidOperationException("Eraser did not clear overlap.");
            // 古い赤線への追記で、後から重ねた消しゴムが消えないことを確認する。
            Send(Add("red", 150, 150, 220, 150)); Flush(); Verify("interleaved-older-stroke");
            Send(StartStroke("blue", "#3b82f6", 5, 150, 130));
            Send(Add("blue", 150, 170)); Flush(); Verify("interleaved-newer-stroke");
            File.WriteAllBytes(Path.Combine(output, "canvas-correctness.png"), surface.Texture.EncodeToPNG());
            VerifyLocalPreview(flags);

            var result = new JObject
            {
                ["ok"] = true, ["unity"] = Application.unityVersion, ["historyStrokes"] = 32, ["historyPointsPerStroke"] = 80,
                ["batches"] = 120, ["pointsPerBatch"] = 3, ["receiveMilliseconds"] = Stats(receives),
                ["receiveAndFlushMilliseconds"] = Stats(costs), ["frameMilliseconds"] = Stats(frames),
                ["allocatedBytesSupported"] = allocated != null, ["allocatedBytes"] = bytes.Count == 0 ? null : Stats(bytes.Select(b => (double)b).ToList()),
                ["checks"] = new JArray(checks)
            };
            File.WriteAllText(Path.Combine(output, "canvas-perf.json"), result.ToString());
            UnityEngine.Debug.Log("TONARIUM_CANVAS_PERF_SUCCESS " + output); Application.Quit();
        }

        static JObject StartStroke(string id, string color, int size, float x, float y) => new JObject { ["a"] = "strokeStart", ["id"] = id, ["color"] = color, ["size"] = size, ["x"] = x, ["y"] = y };
        static JObject Add(string id, params int[] points) => new JObject { ["a"] = "strokeAdd", ["id"] = id, ["pts"] = new JArray(points) };
        static JObject Message(JObject action) => new JObject { ["t"] = "itemAction", ["id"] = ItemId, ["by"] = "canvas-probe", ["action"] = action };
        void Send(JObject action) { receiveArgs[0] = Message(action); receive.Invoke(world, receiveArgs); }
        void Flush() => surface.SendMessage("LateUpdate", SendMessageOptions.DontRequireReceiver);
        void VerifyLocalPreview(BindingFlags flags)
        {
            typeof(TonariumWorld).GetField("selfId", flags).SetValue(world, "preview");
            var send = typeof(TonariumWorld).GetMethod("SendCanvasAction", flags);
            var apply = typeof(TonariumWorld).GetMethod("ApplyDelta", flags);
            var pending = (Dictionary<string, int>)typeof(TonariumWorld).GetField("canvasEchoes", flags).GetValue(world);
            Action<JObject, bool> local = (action, applyNow) =>
            {
                string key = ItemId + ":" + ((string)action["id"] ?? (string)action["a"]);
                pending.TryGetValue(key, out int before);
                send.Invoke(world, new object[] { ItemId, action, applyNow });
                // 未接続のプローブでは、実際の送信待ち件数だけを補う。
                pending.TryGetValue(key, out int after);
                if (after == before) pending[key] = before + 1;
            };
            Action<JObject, string> acknowledge = (action, label) =>
            {
                string before = item["strokes"].ToString(Newtonsoft.Json.Formatting.None);
                var message = Message(action); message["by"] = "preview";
                receiveArgs[0] = message; receive.Invoke(world, receiveArgs); Flush();
                if (item["strokes"].ToString(Newtonsoft.Json.Formatting.None) != before)
                    throw new InvalidOperationException(label + ": own echo changed stroke/point counts.");
                Verify(label);
            };

            Send(new JObject { ["a"] = "canvasClear" }); Flush();
            var start = StartStroke("local-preview", "#3b82f6", 10, 100, 150);
            local(start, true); Flush(); Verify("local-start-before-ack");
            var pixel = surface.Texture.GetPixel(110, 519 - 208);
            if (pixel.b < .9f || pixel.r > .3f || ((JArray)item["strokes"]).Count != 1)
                throw new InvalidOperationException("Local start was not visible before acknowledgement.");
            acknowledge(start, "local-start-ack-no-duplicate");

            var add = Add("local-preview", 150, 150, 200, 150);
            apply.Invoke(world, new object[] { new JObject { ["id"] = ItemId, ["action"] = add } });
            Flush(); Verify("local-points-before-send");
            local(add, false); Flush(); Verify("local-batch-send-no-reapply");
            if (((JArray)item["strokes"][0]["pts"]).Count != 6)
                throw new InvalidOperationException("Local batch duplicated preview points.");
            pixel = surface.Texture.GetPixel(210, 519 - 208);
            if (pixel.b < .9f || pixel.r > .3f) throw new InvalidOperationException("Local append was not visible before acknowledgement.");
            var pendingSnapshot = (JObject)item.DeepClone();
            pendingSnapshot["strokes"][0]["pts"] = new JArray(100, 150);
            ReplaceItem(pendingSnapshot, "pending-points-survive-item-snapshot");
            if (((JArray)item["strokes"][0]["pts"]).Count != 6)
                throw new InvalidOperationException("Pending local points were lost in item snapshot.");
            acknowledge(add, "local-append-ack-no-duplicate");

            var beforeClear = (JObject)item.DeepClone();
            var clear = new JObject { ["a"] = "canvasClear" };
            local(clear, true); Flush(); Verify("local-clear-before-ack");
            var newer = StartStroke("after-clear", "#ef4444", 10, 120, 180);
            local(newer, true); Flush(); Verify("new-stroke-before-clear-ack");
            ReplaceItem(beforeClear, "pending-clear-survives-old-item-snapshot");
            acknowledge(clear, "queued-clear-ack-preserves-new-stroke");
            if (((JArray)item["strokes"]).Count != 1 || (string)item["strokes"][0]["id"] != "after-clear")
                throw new InvalidOperationException("Queued clear acknowledgement erased a newer local stroke.");
            acknowledge(newer, "newer-start-ack-no-duplicate");

            // 次の送信前に全体更新が来ても、描画中の点を保つ。
            var activeItem = typeof(TonariumWorld).GetField("canvasItem", flags);
            var activeStroke = typeof(TonariumWorld).GetField("canvasStroke", flags);
            var previousItem = activeItem.GetValue(world); var previousStroke = activeStroke.GetValue(world);
            try
            {
                activeItem.SetValue(world, ItemId); activeStroke.SetValue(world, "after-clear");
                var unsent = Add("after-clear", 160, 180, 200, 180);
                apply.Invoke(world, new object[] { new JObject { ["id"] = ItemId, ["action"] = unsent } });
                Flush(); Verify("active-unsent-points-before-snapshot");
                if (pending.Count != 0) throw new InvalidOperationException("Active unsent scenario has pending echoes.");
                var activeSnapshot = (JObject)item.DeepClone();
                activeSnapshot["strokes"][0]["pts"] = new JArray(120, 180);
                ReplaceItem(activeSnapshot, "active-unsent-points-survive-item-snapshot");
                if (((JArray)item["strokes"][0]["pts"]).Count != 6)
                    throw new InvalidOperationException("Active unsent local points were lost in item snapshot.");
            }
            finally { activeItem.SetValue(world, previousItem); activeStroke.SetValue(world, previousStroke); }

            var colors = (Dictionary<string, string>)typeof(TonariumWorld).GetField("canvasColors", flags).GetValue(world);
            var sizes = (Dictionary<string, float>)typeof(TonariumWorld).GetField("canvasSizes", flags).GetValue(world);
            string artwork = item["strokes"].ToString(Newtonsoft.Json.Formatting.None);
            colors[ItemId] = "erase"; sizes[ItemId] = 10;
            typeof(TonariumWorld).GetMethod("PaintCanvasToolbar", flags).Invoke(world, new object[] { surface, item });
            Flush(); Verify("toolbar-preserves-artwork");
            if (item["strokes"].ToString(Newtonsoft.Json.Formatting.None) != artwork)
                throw new InvalidOperationException("Toolbar repaint changed artwork state.");
            if (pending.Count != 0) throw new InvalidOperationException("Own acknowledgement queue was not drained.");
            File.WriteAllBytes(Path.Combine(output, "canvas-preview.png"), surface.Texture.EncodeToPNG());
        }
        void ReplaceItem(JObject replacement, string label)
        {
            receiveArgs[0] = new JObject { ["t"] = "item", ["item"] = replacement };
            receive.Invoke(world, receiveArgs);
            item = replacement;
            Flush(); Verify(label);
        }
        static double Milliseconds(long ticks) => ticks * 1000.0 / Stopwatch.Frequency;
        static JObject Stats(List<double> values)
        {
            var sorted = values.OrderBy(x => x).ToArray();
            return new JObject { ["mean"] = values.Average(), ["median"] = sorted[sorted.Length / 2], ["p95"] = sorted[Math.Min(sorted.Length - 1, (int)Math.Ceiling(sorted.Length * .95) - 1)], ["max"] = sorted[sorted.Length - 1], ["samples"] = new JArray(values) };
        }
        void Verify(string name)
        {
            if (surface.Texture != originalTexture || GameObject.Find("Item " + ItemId) != originalRoot) throw new InvalidOperationException(name + ": surface or texture replaced.");
            var raster = new ItemRaster(640, 520, "#2b2d31"); raster.Rect(10, 58, 620, 450, "#ffffff");
            paint.Invoke(null, new object[] { raster, item, 10, 58 });
            var canonical = raster.Texture(); var expected = canonical.GetPixels32(); var actual = surface.Texture.GetPixels32();
            try
            {
                for (int y = 58; y < 508; y++) for (int x = 10; x < 630; x++)
                {
                    int n = (519 - y) * 640 + x; var a = actual[n]; var e = expected[n];
                    if (a.r != e.r || a.g != e.g || a.b != e.b || a.a != e.a) throw new InvalidOperationException(name + ": canonical pixel mismatch at " + x + "," + y);
                }
            }
            finally { Destroy(canonical); }
            checks.Add(name + ": canonical pixels match, original surface and texture retained");
        }
    }
}
