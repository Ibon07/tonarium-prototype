using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia.Threading;
using LiveKit.Proto;
using LiveKit.Rtc;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Media;

/// <summary>
/// Explicit, real-device smoke check. Captures the microphone and desktop for three seconds;
/// never call from the ordinary UI smoke check. Must run on the initialized Avalonia dispatcher.
/// </summary>
public static class NativeMediaSmoke
{
    public static async Task<JsonObject> RunAsync(string livekitUrl = "ws://127.0.0.1:7880",
        string apiKey = "devkey", string apiSecret = "secret", CancellationToken cancellationToken = default)
    {
        if (!Dispatcher.UIThread.CheckAccess()) throw new InvalidOperationException("Run media smoke on the Avalonia UI dispatcher.");
        var roomName = "tonarium-native-smoke-" + Guid.NewGuid().ToString("N");
        var reservation = new TcpListener(IPAddress.Loopback, 0); reservation.Start();
        var port = ((IPEndPoint)reservation.LocalEndpoint).Port; reservation.Stop();
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/"); listener.Start();
        var serve = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                try
                {
                    var context = await listener.GetContextAsync();
                    var identity = context.Request.QueryString["id"] ?? "native-smoke";
                    var bytes = JsonSerializer.SerializeToUtf8Bytes(new { url = livekitUrl, token = Token(identity, roomName, apiKey, apiSecret) });
                    context.Response.ContentType = "application/json";
                    await context.Response.OutputStream.WriteAsync(bytes, cancellationToken);
                    context.Response.Close();
                }
                catch (HttpListenerException) { break; }
                catch (ObjectDisposedException) { break; }
            }
        }, cancellationToken);
        try
        {
            var state = new ClientState();
            await using var client = new TonariumClient(state);
            state.SelfId = "native-smoke"; state.Name = "Native media smoke";
            state.ServerUrl = $"http://127.0.0.1:{port}"; state.SessionId = roomName;
            state.Broadcast = true; state.Mode = "3d";
            state.Users.Add(new JsonObject { ["id"] = state.SelfId, ["name"] = state.Name, ["session"] = roomName, ["mode"] = "2d" });
            state.Users.Add(new JsonObject { ["id"] = "native-peer", ["name"] = "Native peer", ["session"] = roomName, ["mode"] = "2d" });
            await using var media = new NativeMedia(client, initialMicrophoneEnabled: false, persistPreferences: false);
            long jpegFrames = 0;
            media.VideoFrameJpeg += (_, bytes) => { if (bytes.Length > 2 && bytes[0] == 0xff && bytes[1] == 0xd8) Interlocked.Increment(ref jpegFrames); };
            await media.ConnectAsync(roomName);
            if (!media.Connected) throw new InvalidOperationException(media.Status);
            using var peer = new Room();
            using var end = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            long microphoneFrames = 0, screenFrames = 0, loopbackFrames = 0;
            var receivers = new List<Task>();
            peer.TrackSubscribed += (_, e) =>
            {
                lock (receivers) receivers.Add(Task.Run(async () =>
                {
                    try
                    {
                        if (e.Track is RemoteAudioTrack audio)
                        {
                            using var stream = new AudioStream(audio);
                            await foreach (var frame in stream.WithCancellation(end.Token))
                            {
                                if (e.Publication.Source == TrackSource.SourceMicrophone) Interlocked.Increment(ref microphoneFrames);
                                else Interlocked.Increment(ref loopbackFrames);
                            }
                        }
                        else if (e.Track is RemoteVideoTrack video)
                        {
                            using var stream = new VideoStream(video);
                            await foreach (var frame in stream.WithCancellation(end.Token)) Interlocked.Increment(ref screenFrames);
                        }
                    }
                    catch (OperationCanceledException) { }
                }, end.Token));
            };
            try
            {
                await peer.ConnectAsync(livekitUrl, Token("native-peer", roomName, apiKey, apiSecret));
                using var sineSource = new AudioSource(48000, 1);
                using var sine = LocalAudioTrack.Create("smoke-tone", sineSource);
                await peer.LocalParticipant!.PublishTrackAsync(sine, new LiveKit.Rtc.TrackPublishOptions { Source = TrackSource.SourceMicrophone });
                using var imageSource = new VideoSource(160, 90);
                using var image = LocalVideoTrack.Create("smoke-image", imageSource);
                await peer.LocalParticipant.PublishTrackAsync(image, new LiveKit.Rtc.TrackPublishOptions { Source = TrackSource.SourceCamera, Simulcast = false });
                await media.SetMicrophoneAsync(true);
                await media.StartScreenShareAsync(DesktopCapture.EnumerateSources().First(), systemAudio: true);
                if (!state.MicOn || !state.Sharing) throw new InvalidOperationException(media.Status);
                for (var tick = 0; tick < 300; tick++)
                {
                    var pcm = new short[480];
                    for (var i = 0; i < pcm.Length; i++) pcm[i] = (short)(Math.Sin((tick * 480 + i) * Math.PI * 2 * 440 / 48000) * 1000);
                    await sineSource.CaptureFrameAsync(new AudioFrame(pcm, 48000, 1, 480), cancellationToken);
                    if (tick % 5 == 0)
                    {
                        var pixels = new byte[160 * 90 * 4];
                        for (var i = 0; i < pixels.Length; i += 4) { pixels[i] = 90; pixels[i + 1] = 170; pixels[i + 2] = 210; pixels[i + 3] = 255; }
                        imageSource.CaptureFrame(new VideoFrame(160, 90, VideoBufferType.Bgra, pixels));
                    }
                    await Task.Delay(10, cancellationToken);
                }
                var result = new JsonObject
                {
                    ["receivedAudioFrames"] = media.ReceivedAudioFrames,
                    ["receivedVideoFrames"] = media.ReceivedVideoFrames,
                    ["peerReceivedMicrophoneFrames"] = microphoneFrames,
                    ["peerReceivedScreenFrames"] = screenFrames,
                    ["peerReceivedSystemAudioFrames"] = loopbackFrames,
                    ["unityJpegFrames"] = jpegFrames
                };
                if (media.ReceivedAudioFrames == 0 || media.ReceivedVideoFrames == 0 || microphoneFrames == 0 || screenFrames == 0 || jpegFrames == 0)
                    throw new InvalidOperationException("Native media flow incomplete: " + result.ToJsonString());
                await media.SetMicrophoneAsync(false); await media.SetScreenShareAsync(false);
                if (state.MicOn || state.Sharing) throw new InvalidOperationException("Capture did not stop.");
                await media.DisconnectAsync(); await media.ConnectAsync(roomName);
                if (!media.Connected || state.MicOn || state.Sharing) throw new InvalidOperationException("Muted state did not survive rejoin.");
                result["mutedRejoin"] = true; result["status"] = "pass";
                await media.DisconnectAsync();
                return result;
            }
            finally
            {
                end.Cancel();
                await peer.DisconnectAsync();
                Task[] pending; lock (receivers) pending = receivers.ToArray();
                try { await Task.WhenAll(pending); } catch (OperationCanceledException) { }
            }
        }
        finally { listener.Stop(); await serve; }
    }

    private static string Token(string identity, string room, string key, string secret)
    {
        static string Encode(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var header = Encode(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"));
        var claims = Encode(JsonSerializer.SerializeToUtf8Bytes(new
        { iss = key, sub = identity, nbf = now - 30, exp = now + 600, video = new { roomJoin = true, room, canPublish = true, canSubscribe = true } }));
        return header + "." + claims + "." + Encode(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(header + "." + claims)));
    }
}
