using System.Buffers;
using System.Buffers.Binary;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Avalonia.Platform.Storage;
using LibVLCSharp.Shared;
using SkiaSharp;

namespace Tonarium.Desktop.Core;

public static class MediaAttachments
{
    public const int MaxFiles = 5;
    public const long ImageMaxBytes = 10 * 1024 * 1024;
    public const long VideoMaxBytes = 50 * 1024 * 1024;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(3) };
    private static readonly Regex YouTube = new(@"(?:youtube\.com/(?:watch\?(?:[^#\s]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static string? TryYouTubeId(string? text) => text is not null && YouTube.Match(text) is { Success: true } match ? match.Groups[1].Value : null;
    public static string YouTubeUrl(string id) => "https://www.youtube.com/watch?v=" + id;
    public static bool IsSupportedFileName(string name) => Path.GetExtension(name).ToLowerInvariant() is ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".mp4" or ".webm";

    public static async Task<JsonObject> UploadAsync(string serverUrl, IStorageFile file, CancellationToken cancellationToken = default)
    {
        await using var stream = await file.OpenReadAsync();
        return await UploadAsync(serverUrl, stream, file.Name, cancellationToken: cancellationToken);
    }

    public static async Task<JsonObject> UploadBytesAsync(string serverUrl, byte[] bytes, string fileName = "clipboard.png", string? contentType = null, CancellationToken cancellationToken = default)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        return await UploadAsync(serverUrl, stream, fileName, contentType, cancellationToken);
    }

    public static async Task<IReadOnlyList<JsonObject>> UploadFilesAsync(string serverUrl, IEnumerable<IStorageFile> files, CancellationToken cancellationToken = default)
    {
        var result = new List<JsonObject>();
        foreach (var file in files.Where(f => IsSupportedFileName(f.Name)).Take(MaxFiles)) result.Add(await UploadAsync(serverUrl, file, cancellationToken));
        return result;
    }

    public static async Task<JsonObject> UploadAsync(string serverUrl, Stream stream, string fileName, string? contentType = null, CancellationToken cancellationToken = default)
    {
        if (stream.CanSeek && stream.Length - stream.Position > VideoMaxBytes) throw new InvalidOperationException("動画は 50MB、画像は 10MB まで共有できます。");
        var header = new byte[16];
        var headerLength = await stream.ReadAtLeastAsync(header, header.Length, false, cancellationToken);
        var mime = Sniff(header.AsSpan(0, headerLength));
        if (mime is null) throw new InvalidOperationException("画像（JPEG/PNG/GIF/WebP）か動画（MP4/WebM）だけ共有できます。");
        var isVideo = mime.StartsWith("video/", StringComparison.Ordinal);
        var maximum = isVideo ? VideoMaxBytes : ImageMaxBytes;
        if (stream.CanSeek && stream.Length - stream.Position + headerLength > maximum) throw TooLarge(isVideo);
        using var memory = new MemoryStream(); memory.Write(header, 0, headerLength);
        var buffer = ArrayPool<byte>.Shared.Rent(65536);
        try
        {
            int read;
            while ((read = await stream.ReadAsync(buffer.AsMemory(), cancellationToken)) > 0)
            {
                if (memory.Length + read > maximum) throw TooLarge(isVideo);
                memory.Write(buffer, 0, read);
            }
        }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
        var bytes = memory.ToArray();
        var dimensions = isVideo ? await VideoSizeAsync(bytes, cancellationToken) : ImageSize(bytes);
        using var content = new ByteArrayContent(bytes);
        // 拡張子に依存せず、実データに合った形式でサーバーへ送る。
        content.Headers.ContentType = new MediaTypeHeaderValue(mime);
        var endpoint = new Uri(new Uri(serverUrl.TrimEnd('/') + "/"), "media");
        using var response = await Http.PostAsync(endpoint, content, cancellationToken);
        var payload = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var url = J.Text(payload, "url");
        if (!response.IsSuccessStatusCode || string.IsNullOrWhiteSpace(url))
            throw new InvalidOperationException(J.Text(payload, "error", $"アップロードできませんでした（HTTP {(int)response.StatusCode}）。"));
        return new JsonObject { ["kind"] = isVideo ? "video" : "image", ["url"] = url, ["w"] = dimensions.Width, ["h"] = dimensions.Height };
    }

    private static InvalidOperationException TooLarge(bool video) => new(video ? "動画は 50MB まで共有できます。" : "画像は 10MB まで共有できます。");
    private static string? Sniff(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255) return "image/jpeg";
        if (bytes.Length >= 4 && bytes[..4].SequenceEqual(new byte[] { 137, 80, 78, 71 })) return "image/png";
        if (bytes.Length >= 4 && bytes[..4].SequenceEqual("GIF8"u8)) return "image/gif";
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        if (bytes.Length >= 8 && bytes.Slice(4, 4).SequenceEqual("ftyp"u8)) return "video/mp4";
        if (bytes.Length >= 4 && bytes[..4].SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 })) return "video/webm";
        return null;
    }

    private static (int Width, int Height) ImageSize(byte[] bytes)
    {
        using var data = new SKMemoryStream(bytes); using var codec = SKCodec.Create(data);
        if (codec is null || codec.Info.Width <= 0 || codec.Info.Height <= 0) throw new InvalidOperationException("画像を読み込めませんでした。");
        return (int)codec.EncodedOrigin >= 5 ? (codec.Info.Height, codec.Info.Width) : (codec.Info.Width, codec.Info.Height);
    }

    private static async Task<(int Width, int Height)> VideoSizeAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        if (Sniff(bytes) == "video/mp4" && Mp4Size(bytes, 0, bytes.Length, 0) is { } mp4) return mp4;
        if (Sniff(bytes) == "video/webm" && WebmSize(bytes, 0, bytes.Length, 0) is { } webm) return webm;
        // 通常はヘッダーだけで済ませ、特殊なコンテナーだけVLCへ渡す。
        try
        {
            LibVLCSharp.Shared.Core.Initialize();
            using var vlc = new LibVLC("--quiet", "--no-video", "--no-audio");
            using var stream = new MemoryStream(bytes, writable: false); using var input = new StreamMediaInput(stream);
            using var media = new LibVLCSharp.Shared.Media(vlc, input);
            await media.Parse(MediaParseOptions.ParseLocal, 5000, cancellationToken);
            foreach (var track in media.Tracks)
                if (track.TrackType == TrackType.Video && track.Data.Video.Width > 0 && track.Data.Video.Height > 0)
                    return ((int)track.Data.Video.Width, (int)track.Data.Video.Height);
        }
        catch (Exception ex) when (ex is not OperationCanceledException) { }
        return (16, 9); // サイズ不明時はWeb版と同じ比率にする。
    }

    private static (int Width, int Height)? Mp4Size(byte[] data, int start, int end, int depth)
    {
        if (depth > 5) return null;
        for (var offset = start; offset + 8 <= end;)
        {
            ulong length = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(offset)); var header = 8;
            if (length == 1) { if (offset + 16 > end) break; length = BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(offset + 8)); header = 16; }
            if (length == 0) length = (ulong)(end - offset);
            if (length < (ulong)header || length > (ulong)(end - offset)) break;
            var next = offset + (int)length; var kind = Encoding.ASCII.GetString(data, offset + 4, 4);
            if (kind == "tkhd" && length >= 84)
            {
                var width = (int)(BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(next - 8)) >> 16);
                var height = (int)(BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(next - 4)) >> 16);
                if (width > 0 && height > 0) return (width, height);
            }
            if (kind is "moov" or "trak" or "mdia")
                if (Mp4Size(data, offset + header, next, depth + 1) is { } size) return size;
            offset = next;
        }
        return null;
    }

    private static (int Width, int Height)? WebmSize(byte[] data, int start, int end, int depth)
    {
        if (depth > 6) return null;
        var width = 0; var height = 0;
        for (var offset = start; offset < end;)
        {
            if (!EbmlNumber(data, ref offset, end, true, out var id) || !EbmlNumber(data, ref offset, end, false, out var length)) break;
            var next = length > (ulong)(end - offset) ? end : offset + (int)length;
            if (next <= offset) break;
            if ((id is 0xB0 or 0xBA) && next - offset <= 4)
            {
                var value = 0; for (var i = offset; i < next; i++) value = (value << 8) | data[i];
                if (id == 0xB0) width = value; else height = value;
                if (width > 0 && height > 0) return (width, height);
            }
            if (id is 0x1A45DFA3 or 0x18538067 or 0x1654AE6B or 0xAE or 0xE0)
                if (WebmSize(data, offset, next, depth + 1) is { } size) return size;
            offset = next;
        }
        return null;
    }

    private static bool EbmlNumber(byte[] data, ref int offset, int end, bool identifier, out ulong value)
    {
        value = 0; if (offset >= end) return false;
        var mask = 0x80; var count = 1;
        while (count <= 8 && (data[offset] & mask) == 0) { mask >>= 1; count++; }
        if (count > 8 || offset + count > end) return false;
        value = identifier ? data[offset] : (ulong)(data[offset] & (mask - 1)); offset++;
        for (var i = 1; i < count; i++) value = (value << 8) | data[offset++];
        if (!identifier && value == (1UL << (count * 7)) - 1) value = ulong.MaxValue;
        return true;
    }
}
