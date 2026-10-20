using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Avalonia.Threading;
using LiveKit.Proto;
using LiveKit.Rtc;
using SkiaSharp;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Media;

public sealed partial class NativeMedia
{
    private readonly ConcurrentDictionary<string, CameraPublisher> cameras = new();
    private volatile HashSet<string> eligibleCameras = new(StringComparer.Ordinal);
    private long publishedCameraFrames;
    public long PublishedCameraFrames => Interlocked.Read(ref publishedCameraFrames);
    public int ActiveCameraPublications => cameras.Values.Count(p => p.PublicationSid is not null);

    /// <summary>Accepts a virtual scene-camera frame from Unity. It never opens a physical camera.</summary>
    public void SubmitCameraFrame(string itemId, byte[] jpeg)
    {
        if (disposed || closing || !Connected || jpeg.Length is 0 or > 5_000_000) return;
        // JSON状態はUIスレッドで保持し、配信ワーカーには判定済みのIDだけを渡す。
        if (!eligibleCameras.Contains(itemId)) return;
        var publisher = cameras.GetOrAdd(itemId, static id => new CameraPublisher(id));
        lock (publisher.Sync)
        {
            if (publisher.Stopped) return;
            publisher.PendingJpeg = jpeg;
            if (publisher.Pumping) return;
            publisher.Pumping = true;
        }
        _ = Task.Run(() => PumpCameraAsync(publisher));
    }

    private async Task PumpCameraAsync(CameraPublisher publisher)
    {
        try
        {
            while (true)
            {
                byte[]? jpeg;
                lock (publisher.Sync)
                {
                    jpeg = publisher.PendingJpeg; publisher.PendingJpeg = null;
                    if (publisher.Stopped || jpeg is null) return;
                }
                if (!eligibleCameras.Contains(publisher.Id) || closing) return;
                using var decoded = SKBitmap.Decode(jpeg);
                if (decoded is null) continue;
                using var bitmap = new SKBitmap(new SKImageInfo(640, 360, SKColorType.Bgra8888, SKAlphaType.Opaque));
                using (var canvas = new SKCanvas(bitmap))
                {
                    canvas.Clear(SKColors.Black);
                    canvas.DrawBitmap(decoded, new SKRect(0, 0, 640, 360));
                }
                var pixels = new byte[640 * 360 * 4];
                Marshal.Copy(bitmap.GetPixels(), pixels, 0, pixels.Length);
                var frame = new VideoFrame(640, 360, VideoBufferType.Bgra, pixels);
                await gate.WaitAsync();
                try
                {
                    if (publisher.Stopped || closing || room?.LocalParticipant is null || !eligibleCameras.Contains(publisher.Id)) return;
                    if (publisher.Source is null)
                    {
                        publisher.Source = new VideoSource(640, 360);
                        publisher.Track = LocalVideoTrack.Create("camera:" + publisher.Id, publisher.Source);
                        publisher.PublicationSid = (await room.LocalParticipant.PublishTrackAsync(publisher.Track,
                            new LiveKit.Rtc.TrackPublishOptions
                            {
                                Source = TrackSource.SourceCamera, Simulcast = false, VideoCodec = VideoCodec.Vp8,
                                VideoEncoding = new VideoEncodingOptions { MaxBitrate = 1_200_000, MaxFramerate = 15 }
                            })).Sid;
                    }
                    publisher.Source.CaptureFrame(frame);
                    Interlocked.Increment(ref publishedCameraFrames);
                }
                finally { gate.Release(); }
                PushVideo(client.State.SelfId, "camera:" + publisher.Id, frame);
            }
        }
        catch (Exception ex)
        {
            if (disposed || closing) return;
            SetStatus("カメラ配信: " + SafeError(ex));
            cameras.TryRemove(new KeyValuePair<string, CameraPublisher>(publisher.Id, publisher));
            await StopCameraAsync(publisher);
            await Dispatcher.UIThread.InvokeAsync(async () =>
            {
                if (eligibleCameras.Contains(publisher.Id))
                    await client.SendRoomAsync(new { t = "itemAction", id = publisher.Id, action = new { a = "camLive", on = false } });
            });
        }
        finally
        {
            lock (publisher.Sync)
            {
                publisher.Pumping = false;
                if (publisher.PendingJpeg is not null && !publisher.Stopped && eligibleCameras.Contains(publisher.Id) && !closing && !disposed)
                {
                    publisher.Pumping = true;
                    _ = Task.Run(() => PumpCameraAsync(publisher));
                }
            }
        }
    }

    private void SyncCameraTracks()
    {
        var state = client.State;
        var next = new HashSet<string>(StringComparer.Ordinal);
        if (state.Mode == "3d" && state.SessionId is not null)
            foreach (var pair in state.Items)
                if (J.Text(pair.Value, "kind") == "camera" && J.Bool(pair.Value, "live") && J.Text(pair.Value, "operator") == state.SelfId)
                    next.Add(pair.Key);
        eligibleCameras = next;
        foreach (var pair in cameras)
            if (!next.Contains(pair.Key) && cameras.TryRemove(new KeyValuePair<string, CameraPublisher>(pair.Key, pair.Value)))
                _ = StopCameraAsync(pair.Value);
    }

    private async Task StopCameraAsync(CameraPublisher publisher)
    {
        lock (publisher.Sync) { publisher.Stopped = true; publisher.PendingJpeg = null; }
        await gate.WaitAsync();
        try { await StopCameraCoreAsync(publisher); }
        finally { gate.Release(); }
    }

    private async Task StopCameraCoreAsync(CameraPublisher publisher)
    {
        lock (publisher.Sync) { publisher.Stopped = true; publisher.PendingJpeg = null; }
        if (publisher.PublicationSid is not null && room?.IsConnected == true)
            try { await room.LocalParticipant!.UnpublishTrackAsync(publisher.PublicationSid); } catch (Exception) { }
        publisher.Track?.Dispose(); publisher.Track = null;
        publisher.Source?.Dispose(); publisher.Source = null;
        publisher.PublicationSid = null;
        var key = "camera:" + publisher.Id;
        if (video.TryGetValue(key, out var feed)) feed.Clear();
        if (video.TryGetValue(publisher.Id, out feed)) feed.Clear();
        VideoFrameJpeg?.Invoke(key, []);
    }

    private async Task StopAllCamerasCoreAsync()
    {
        foreach (var pair in cameras)
            if (cameras.TryRemove(new KeyValuePair<string, CameraPublisher>(pair.Key, pair.Value))) await StopCameraCoreAsync(pair.Value);
    }

    private sealed class CameraPublisher(string id)
    {
        public string Id { get; } = id;
        public object Sync { get; } = new();
        public byte[]? PendingJpeg;
        public bool Pumping, Stopped;
        public VideoSource? Source;
        public LocalVideoTrack? Track;
        public string? PublicationSid;
    }
}
