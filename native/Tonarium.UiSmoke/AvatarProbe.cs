using System.Net.Http.Headers;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;
using Tonarium.Desktop.Views;
using Drawing = System.Drawing;

/// <summary>Exercises the real portrait control, its original model and server-backed texture lifecycle.</summary>
internal static class AvatarProbe
{
    internal static async Task VerifyOffline(string server, string output, Action<string> pass)
    {
        var name = "UI offline avatar " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await using var client = new TonariumClient(new ClientState { ServerUrl = server, Name = "Offline profile verifier" }, persistSettings: false);
        await using var media = new NativeMedia(client);
        var owner = new Window { Width = 1000, Height = 640, Title = "Offline profile verification" };
        var context = new NativeContext(client, media, owner);
        using var http = new HttpClient();
        var fixture = TextureFixture(output);
        using (var body = new ByteArrayContent(await File.ReadAllBytesAsync(fixture)))
        {
            body.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            using var result = await http.PostAsync(server.TrimEnd('/') + "/avatar?name=" + Uri.EscapeDataString(name), body);
            result.EnsureSuccessStatusCode();
        }
        using (var body = new StringContent("{\"headSize\":0.2,\"neckLength\":0.05,\"handSize\":0.1,\"bodySize\":-0.1}"))
        {
            body.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            using var result = await http.PostAsync(server.TrimEnd('/') + "/avatar/params?name=" + Uri.EscapeDataString(name), body);
            result.EnsureSuccessStatusCode();
        }
        pass("Persisted custom avatar and manifest for an offline name");
        owner.Show();
        var profile = new ProfileWindow(context, name);
        try
        {
            profile.Show(owner);
            if (client.State.Users.Any(u => J.Text(u, "name") == name)) throw new InvalidOperationException("Offline fixture unexpectedly appears in online users.");
            var portrait = profile.GetVisualDescendants().OfType<AvatarPortrait>().Single();
            await Until(() => portrait.IsCustomTexture && portrait.IsTextureReady && portrait.FrameCount > 0, "Offline profile resolves its persisted custom avatar");
            var skin = typeof(AvatarPortrait).GetField("skin", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(portrait)!;
            var parameters = skin.GetType().GetProperty("Parameters")!.GetValue(skin)!;
            var headSize = Convert.ToDouble(parameters.GetType().GetProperty("HeadSize")!.GetValue(parameters));
            var handSize = Convert.ToDouble(parameters.GetType().GetProperty("HandSize")!.GetValue(parameters));
            if (Math.Abs(headSize - 0.2) > 0.0001 || Math.Abs(handSize - 0.1) > 0.0001)
                throw new InvalidOperationException("Offline profile did not load persisted nondefault manifest parameters.");
            if (!portrait.TextureKey.Contains(name, StringComparison.Ordinal) || !portrait.TextureKey.EndsWith("@stored", StringComparison.Ordinal))
                throw new InvalidOperationException("Offline profile resolved the wrong stored identity.");
            pass("Offline name-only profile loads stored texture and nondefault manifest parameters");
            await Tick();
            var snapshot = Snapshot(portrait, output, "offline-custom-avatar");
            if (snapshot.UniqueColors < 16) throw new InvalidOperationException("Offline custom avatar rendered blank.");
            using var frame = profile.CaptureRenderedFrame() ?? throw new InvalidOperationException("Offline profile has no rendered frame.");
            frame.Save(Path.Combine(output, "offline-profile.png"));
            File.WriteAllText(Path.Combine(output, "offline-avatar-result.json"), JsonSerializer.Serialize(new
            {
                passed = true, name, onlineUsers = client.State.Users.Count, portrait.IsCustomTexture, portrait.IsTextureReady,
                portrait.TextureKey, headSize, handSize, portrait.TriangleCount, portrait.AnimationChannelCount, snapshot
            }, new JsonSerializerOptions { WriteIndented = true }));
            pass("Offline custom profile and nonblank portrait screenshots captured");
        }
        finally { profile.Close(); owner.Close(); }
    }

    internal static async Task Verify(Window main, TonariumClient client, TonariumClient peer, string output, Action<string> pass)
    {
        var type = typeof(MainWindow).Assembly.GetType("Tonarium.Desktop.Views.AvatarPortrait")
            ?? throw new InvalidOperationException("Native animated AvatarPortrait is missing.");
        var roomPortraits = main.GetVisualDescendants().OfType<Control>().Where(x => x.GetType() == type).ToArray();
        if (roomPortraits.Length < 2) throw new InvalidOperationException("Both room participants need animated portraits.");
        await Until(() => roomPortraits.All(x => Property<bool>(x, "IsTextureReady")), "Room portraits load original model and sample textures");
        if (roomPortraits.Any(x => Property<int>(x, "TriangleCount") < 20 || Property<int>(x, "AnimationChannelCount") == 0))
            throw new InvalidOperationException("Portrait must use the original animated model, not a static image or placeholder.");
        pass("Both visible room portraits use loaded animated Oekaki model");

        var context = (NativeContext)typeof(MainWindow).GetField("context", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(main)!;
        var portrait = (Control)Activator.CreateInstance(type, context, peer.State.SelfId, false)!;
        var window = new Window { Title = "Oekaki portrait verification", Width = 480, Height = 360, Content = portrait };
        window.Show(main);
        var evidence = new List<object>();
        try
        {
            await Until(() => Property<bool>(portrait, "IsTextureReady") && Property<long>(portrait, "FrameCount") > 0, "Portrait rendered");
            await Tick();
            var startFrame = Property<long>(portrait, "FrameCount");
            var first = Snapshot(portrait, output, "avatar-original-idle-a");
            await Task.Delay(650); await Tick();
            var second = Snapshot(portrait, output, "avatar-original-idle-b");
            if (first.UniqueColors < 16 || second.UniqueColors < 16) throw new InvalidOperationException("Portrait image is blank or a solid-color placeholder.");
            if (first.Hash == second.Hash || Property<long>(portrait, "FrameCount") <= startFrame)
                throw new InvalidOperationException("Original Oekaki idle animation did not change rendered pixels.");
            evidence.Add(new { scenario = "original-model-idle", triangles = Property<int>(portrait, "TriangleCount"), animationChannels = Property<int>(portrait, "AnimationChannelCount"), frameStart = startFrame, frameEnd = Property<long>(portrait, "FrameCount"), first, second });
            pass("Original Oekaki idle animation changes native portrait pixels");

            var framesDirectory = Path.Combine(output, "avatar-animation-frames"); Directory.CreateDirectory(framesDirectory);
            for (var index = 0; index < 32; index++)
            {
                type.GetProperty("Speaking")?.SetValue(portrait, index >= 22 ? (bool?)true : null);
                await Task.Delay(140); await Tick();
                Snapshot(portrait, framesDirectory, index.ToString("D3"));
            }
            type.GetProperty("Speaking")?.SetValue(portrait, null);
            pass("Animated portrait frames captured for idle, blinking and speaking GIF");

            // Speaking is a local media state: simulate the same flag delivered by LiveKit.
            var presence = client.State.Presence[peer.State.SelfId] as JsonObject;
            if (presence is null) { presence = new JsonObject(); client.State.Presence[peer.State.SelfId] = presence; }
            presence["speaking"] = true;
            type.GetProperty("Speaking")?.SetValue(portrait, (bool?)true);
            client.State.Touch();
            await Task.Delay(200); await Tick();
            var speaking = Snapshot(portrait, output, "avatar-speaking");
            presence["speaking"] = false; type.GetProperty("Speaking")?.SetValue(portrait, null); client.State.Touch();
            evidence.Add(new { scenario = "speaking-media-flag", speaking, syntheticMediaFlag = true });
            pass("Native portrait renders speaking state from local media presence");

            await peer.SendRoomAsync(new { t = "mode", mode = "3d" });
            await peer.SendRoomAsync(new { t = "avatar", s = new { x = 0, z = 1, ry = 0, pitch = 0.8 } });
            await Until(() => Math.Abs(J.Number(client.State.Avatars[peer.State.SelfId], "pitch") - 0.8) < 0.001, "Remote look pitch arrived");
            await Tick();
            evidence.Add(new { scenario = "remote-look-pitch", image = Snapshot(portrait, output, "avatar-look-up") });
            pass("Remote 3D look pitch reaches native Oekaki portrait");

            using var http = new HttpClient();
            var endpoint = client.State.ServerUrl.TrimEnd('/') + "/avatar?name=" + Uri.EscapeDataString(peer.State.Name);
            var fixture = TextureFixture(output);
            using var body = new ByteArrayContent(await File.ReadAllBytesAsync(fixture));
            body.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            using var uploaded = await http.PostAsync(endpoint, body); uploaded.EnsureSuccessStatusCode();
            var response = JsonNode.Parse(await uploaded.Content.ReadAsStringAsync());
            await peer.SendAsync(new { t = "profileUpdated" });
            await Until(() => Property<bool>(portrait, "IsCustomTexture") && Property<bool>(portrait, "IsTextureReady"), "Server custom avatar texture loads");
            await Tick();
            var custom = Snapshot(portrait, output, "avatar-custom-texture");
            if (custom.Hash == second.Hash || custom.UniqueColors < 16) throw new InvalidOperationException("Uploaded custom texture must alter portrait pixels and remain visible.");
            evidence.Add(new { scenario = "uploaded-custom-texture", fixture, version = response?["avatar"]?.ToString(), textureKey = Property<string>(portrait, "TextureKey"), image = custom });
            pass("Uploaded avatar texture appears on the original animated model");

            var oldKey = Property<string>(portrait, "TextureKey");
            using var parameters = new StringContent(new JsonObject { ["headSize"] = 0.2, ["neckLength"] = 0.05, ["bodySize"] = -0.1, ["handSize"] = 0.1 }.ToJsonString());
            parameters.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            using var paramsResponse = await http.PostAsync(client.State.ServerUrl.TrimEnd('/') + "/avatar/params?name=" + Uri.EscapeDataString(peer.State.Name), parameters);
            paramsResponse.EnsureSuccessStatusCode(); await peer.SendAsync(new { t = "profileUpdated" });
            await Until(() => Property<string>(portrait, "TextureKey") != oldKey && Property<bool>(portrait, "IsTextureReady"), "Avatar manifest parameters refresh");
            await Tick();
            var adjusted = Snapshot(portrait, output, "avatar-custom-params");
            evidence.Add(new { scenario = "uploaded-manifest-parameters", image = adjusted });
            if (adjusted.UniqueColors < 16) throw new InvalidOperationException("Avatar disappeared after uploaded manifest parameters.");
            pass("Uploaded Oekaki manifest parameters refresh the portrait");

            var export = type.GetMethod("ExportVerification", BindingFlags.Public | BindingFlags.Static)
                ?? throw new MissingMethodException(type.FullName, "ExportVerification");
            var exportDir = Path.Combine(output, "avatar-rasterizer"); Directory.CreateDirectory(exportDir);
            if (export.Invoke(null, [exportDir]) is Task task) await task;
            var baseline = SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(exportDir, "normal.png")));
            foreach (var state in new[] { "idle-later", "blink", "speaking", "look-up", "full-body" })
            {
                var stateBytes = await File.ReadAllBytesAsync(Path.Combine(exportDir, state + ".png"));
                if (baseline.SequenceEqual(SHA256.HashData(stateBytes)))
                    throw new InvalidOperationException("Deterministic avatar state did not alter pixels: " + state);
            }
            pass("Deterministic original-model rasterizer snapshots exported");
            await peer.SendRoomAsync(new { t = "mode", mode = "2d" });
        }
        finally
        {
            window.Close();
            File.WriteAllText(Path.Combine(output, "avatar-verification.json"), JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));
        }
        await MeasureIdle(main, type, output, pass);
    }

    private static async Task MeasureIdle(Window main, Type type, string output, Action<string> pass)
    {
        await Tick();
        var portraits = main.GetVisualDescendants().OfType<Control>().Where(x => x.GetType() == type).ToArray();
        using var process = Process.GetCurrentProcess();
        var initialCpu = process.TotalProcessorTime; var initial = portraits.Sum(p => Property<long>(p, "FrameCount"));
        var stopwatch = Stopwatch.StartNew(); var samples = new List<double>();
        while (stopwatch.Elapsed < TimeSpan.FromSeconds(5))
        {
            await Tick();
            foreach (var portrait in portraits)
                if (type.GetProperty("LastRenderMilliseconds")?.GetValue(portrait) is double cost) samples.Add(cost);
        }
        stopwatch.Stop(); process.Refresh();
        var cpuMs = (process.TotalProcessorTime - initialCpu).TotalMilliseconds;
        var result = new
        {
            elapsedSeconds = stopwatch.Elapsed.TotalSeconds, visiblePortraits = portraits.Length,
            renderedFrames = portraits.Sum(p => Property<long>(p, "FrameCount")) - initial,
            averageRasterMilliseconds = samples.Count > 0 ? samples.Average() : (double?)null,
            p95RasterMilliseconds = samples.Count > 0 ? samples.Order().ElementAt((int)((samples.Count - 1) * 0.95)) : (double?)null,
            processCpuMilliseconds = cpuMs, processCpuPercentOfOneCore = cpuMs / stopwatch.Elapsed.TotalMilliseconds * 100,
            processWorkingSetBytes = process.WorkingSet64, processPrivateMemoryBytes = process.PrivateMemorySize64,
            managedHeapBytes = GC.GetTotalMemory(false),
            note = "Five-second headless Skia UI idle sample with native media connected and two animated portraits. Test harness CPU, GC and software rasterization are included; this is not a desktop GPU benchmark."
        };
        File.WriteAllText(Path.Combine(output, "avatar-idle-performance.json"), JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        pass("Five-second native portrait idle performance sample recorded");
    }

    private static T Property<T>(object value, string name) => (T)(value.GetType().GetProperty(name)!.GetValue(value)
        ?? throw new InvalidOperationException("Portrait diagnostic is null: " + name));
    private static async Task Tick() { await Task.Delay(100); AvaloniaHeadlessPlatform.ForceRenderTimerTick(2); }
    private static async Task Until(Func<bool> condition, string label)
    {
        var deadline = DateTime.UtcNow.AddSeconds(40);
        while (DateTime.UtcNow < deadline) { await Tick(); if (condition()) return; }
        throw new TimeoutException(label);
    }
    private sealed record Frame(string Path, string Hash, int UniqueColors);
    private static Frame Snapshot(Control control, string output, string name)
    {
        var size = new PixelSize(Math.Max(1, (int)control.Bounds.Width), Math.Max(1, (int)control.Bounds.Height));
        using var bitmap = new RenderTargetBitmap(size, new Vector(96, 96)); bitmap.Render(control);
        var path = System.IO.Path.Combine(output, name + ".png"); bitmap.Save(path);
        var length = checked(size.Width * size.Height * 4); var memory = Marshal.AllocHGlobal(length);
        try
        {
            bitmap.CopyPixels(new PixelRect(0, 0, size.Width, size.Height), memory, length, size.Width * 4);
            var bytes = new byte[length]; Marshal.Copy(memory, bytes, 0, length);
            var colors = new HashSet<uint>();
            for (var i = 0; i < bytes.Length; i += 4) colors.Add(BitConverter.ToUInt32(bytes, i));
            return new Frame(path, Convert.ToHexString(SHA256.HashData(bytes)), colors.Count);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    private static string TextureFixture(string directory)
    {
        var path = Path.Combine(directory, "avatar-upload-fixture.png");
        using var image = new Drawing.Bitmap(2048, 1024);
        using (var graphics = Drawing.Graphics.FromImage(image))
        {
            graphics.Clear(Drawing.Color.Gold);
            graphics.FillRectangle(Drawing.Brushes.Magenta, 0, 0, 1024, 1024);
            graphics.FillRectangle(Drawing.Brushes.DeepSkyBlue, 1024, 0, 1024, 1024);
        }
        image.Save(path, Drawing.Imaging.ImageFormat.Png);
        return path;
    }
}
