using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using LiveKit.Proto;
using LiveKit.Rtc;
using NAudio.Wave;
using Tonarium.Desktop.Media;

internal static class AudioTransmitProbe
{
    // 録音せず送信処理だけを確認するため、取得イベントに生成したPCMを渡す。
    public static async Task Run(string output, Action<string> pass)
    {
        Directory.CreateDirectory(output);
        var roomName = "tonarium-audio-tx-" + Guid.NewGuid().ToString("N");
        var tokenMethod = typeof(NativeMediaSmoke).GetMethod("Token", BindingFlags.NonPublic | BindingFlags.Static)!;
        string Token(string identity) => (string)tokenMethod.Invoke(null, [identity, roomName, "devkey", "secret"])!;
        using var publisher = new Room(); using var peer = new Room();
        using var stop = new CancellationTokenSource();
        var receiveStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Task receiver = Task.CompletedTask;
        long receivedFrames = 0, receivedSamples = 0, nonzeroFrames = 0;
        double receivedSquares = 0; int receivedPeak = 0;
        double earlySquares = 0, lateSquares = 0; long earlySamples = 0, lateSamples = 0;
        var failures = new System.Collections.Concurrent.ConcurrentQueue<string>();
        var watch = Stopwatch.StartNew(); long firstFrameMs = -1, lastFrameMs = -1;
        peer.TrackSubscribed += (_, e) =>
        {
            if (e.Track is not RemoteAudioTrack track || e.Publication.Source != TrackSource.SourceMicrophone) return;
            receiver = Task.Run(async () =>
            {
                using var stream = new AudioStream(track, 48000, 1);
                receiveStarted.TrySetResult();
                try
                {
                    await foreach (var packet in stream.WithCancellation(stop.Token))
                    {
                        var pcm = packet.Frame.DataArray;
                        var peak = 0; double energy = 0;
                        foreach (var sample in pcm) { peak = Math.Max(peak, Math.Abs((int)sample)); energy += (double)sample * sample; }
                        if (firstFrameMs < 0) firstFrameMs = watch.ElapsedMilliseconds;
                        receivedFrames++; receivedSamples += pcm.Length; receivedSquares += energy;
                        lastFrameMs = watch.ElapsedMilliseconds;
                        if (watch.ElapsedMilliseconds < 3000) { earlySamples += pcm.Length; earlySquares += energy; }
                        if (watch.ElapsedMilliseconds >= 12000) { lateSamples += pcm.Length; lateSquares += energy; }
                        receivedPeak = Math.Max(receivedPeak, peak); if (peak > 100) nonzeroFrames++;
                    }
                }
                catch (OperationCanceledException) { }
            });
        };
        object? capture = null; LocalAudioTrack? audioTrack = null; string? publicationSid = null;
        try
        {
            await peer.ConnectAsync("ws://127.0.0.1:7880", Token("audio-viewer"));
            await publisher.ConnectAsync("ws://127.0.0.1:7880", Token("audio-source"));
            var captureType = typeof(NativeMedia).Assembly.GetType("Tonarium.Desktop.Media.NativeAudioCapture")!;
            // Constructor reads endpoint format only. Deliberately never call NativeAudioCapture.Start().
            capture = Activator.CreateInstance(captureType, [false, null])!;
            var waveBuffer = (BufferedWaveProvider)captureType.GetField("buffer", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(capture)!;
            var format = waveBuffer.WaveFormat;
            var source = (AudioSource)captureType.GetProperty("Source")!.GetValue(capture)!;
            var onData = captureType.GetMethod("OnData", BindingFlags.NonPublic | BindingFlags.Instance)!;
            long convertedBlocks = 0, convertedNonzeroBlocks = 0; double convertedRmsMax = 0;
            Action<float, float> level = (rms, peak) => { convertedBlocks++; if (peak > .003f) convertedNonzeroBlocks++; convertedRmsMax = Math.Max(convertedRmsMax, rms); };
            captureType.GetEvent("LevelAvailable")!.AddEventHandler(capture, level);
            captureType.GetEvent("Failed")!.AddEventHandler(capture, new Action<Exception>(ex => failures.Enqueue(ex.GetBaseException().Message)));
            audioTrack = LocalAudioTrack.Create("synthetic-production-microphone", source);
            publicationSid = (await publisher.LocalParticipant!.PublishTrackAsync(audioTrack, new LiveKit.Rtc.TrackPublishOptions
            { Source = TrackSource.SourceMicrophone, Dtx = true, Red = true, AudioEncoding = new AudioEncodingOptions { MaxBitrate = 48000 } })).Sid;
            await receiveStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
            watch.Restart();
            long totalInputSamples = 0;
            for (var block = 0; block < 320; block++)
            {
                var frames = format.SampleRate / 20; // Same 50ms packet batches as WASAPI's default poll.
                var bytes = new byte[frames * format.BlockAlign];
                for (var i = 0; i < frames; i++)
                {
                    var value = (float)(.2 * Math.Sin((totalInputSamples + i) * 2 * Math.PI * 440 / format.SampleRate));
                    for (var channel = 0; channel < format.Channels; channel++)
                    {
                        var offset = i * format.BlockAlign + channel * format.BitsPerSample / 8;
                        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
                            BitConverter.TryWriteBytes(bytes.AsSpan(offset, 4), value);
                        else if (format.BitsPerSample == 16)
                            BitConverter.TryWriteBytes(bytes.AsSpan(offset, 2), (short)(value * 32767));
                        else if (format.BitsPerSample == 32)
                            BitConverter.TryWriteBytes(bytes.AsSpan(offset, 4), (int)(value * int.MaxValue));
                        else if (format.BitsPerSample == 24)
                        {
                            var sample = (int)(value * 8388607); bytes[offset] = (byte)sample; bytes[offset + 1] = (byte)(sample >> 8); bytes[offset + 2] = (byte)(sample >> 16);
                        }
                        else throw new InvalidOperationException("Unhandled capture format: " + format);
                    }
                }
                totalInputSamples += frames;
                onData.Invoke(capture, [null, new WaveInEventArgs(bytes, bytes.Length)]);
                await Task.Delay(50);
            }
            await Task.Delay(250);
            stop.Cancel(); await receiver;
            var receivedRms = receivedSamples == 0 ? 0 : Math.Sqrt(receivedSquares / receivedSamples) / 32768;
            var earlyReceivedRms = earlySamples == 0 ? 0 : Math.Sqrt(earlySquares / earlySamples) / 32768;
            var lateReceivedRms = lateSamples == 0 ? 0 : Math.Sqrt(lateSquares / lateSamples) / 32768;
            var result = new
            {
                passed = convertedNonzeroBlocks > 0 && nonzeroFrames > 0 && receivedRms > .01 && lateReceivedRms > .01 && failures.IsEmpty,
                physicalCaptureStarted = false,
                inputFormat = format.ToString(), inputSampleRate = format.SampleRate, inputChannels = format.Channels,
                convertedBlocks, convertedNonzeroBlocks, convertedRmsMax,
                receivedFrames, nonzeroFrames, receivedSamples, receivedPeak, receivedRms, firstFrameMs, lastFrameMs,
                earlyReceivedRms, lateReceivedRms, earlySamples, lateSamples, failures = failures.ToArray(),
                expectedSineRms = .2 / Math.Sqrt(2)
            };
            File.WriteAllText(Path.Combine(output, "audio-transmit.json"), JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            if (!result.passed) throw new InvalidOperationException("Synthetic microphone TX had no audible energy; see audio-transmit.json.");
            pass($"Synthetic TX production conversion → LiveKit: RMS {receivedRms:F4}, {nonzeroFrames} nonzero frames; no physical capture.");
        }
        finally
        {
            stop.Cancel();
            if (capture is IAsyncDisposable disposable) await disposable.DisposeAsync();
            if (publicationSid is not null && publisher.IsConnected) await publisher.LocalParticipant!.UnpublishTrackAsync(publicationSid);
            audioTrack?.Dispose(); await publisher.DisconnectAsync(); await peer.DisconnectAsync();
            try { await receiver; } catch (OperationCanceledException) { }
        }
    }
}
