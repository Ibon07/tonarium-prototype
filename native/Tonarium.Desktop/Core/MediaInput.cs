using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Platform.Storage;
using SkiaSharp;

namespace Tonarium.Desktop.Core;

public sealed record MediaInputContent(IReadOnlyList<IStorageFile> Files, byte[]? PngBytes, string Text)
{
    public bool HasMedia => Files.Count > 0 || PngBytes is { Length: > 0 };
    public string? YouTubeId => MediaAttachments.TryYouTubeId(Text);
}

public static class MediaInput
{
    public static async Task<MediaInputContent> ReadClipboardAsync(IClipboard clipboard)
    {
        IReadOnlyList<IStorageFile> files = Array.Empty<IStorageFile>(); byte[]? png = null; var text = "";
        using (var data = await clipboard.TryGetDataAsync())
        {
            if (data is not null)
            {
                files = FilterFiles(await data.TryGetFilesAsync());
                text = await data.TryGetTextAsync() ?? await data.TryGetValueAsync(DataFormat.CreateStringPlatformFormat("text/uri-list")) ?? "";
                if (files.Count == 0)
                {
                    try
                    {
                        using var bitmap = await data.TryGetBitmapAsync();
                        if (bitmap is not null) { using var output = new MemoryStream(); bitmap.Save(output); png = output.ToArray(); }
                    }
                    catch (Exception ex) when (ex is NotSupportedException or ArgumentException or InvalidOperationException) { }
                }
            }
        }
        if (files.Count == 0 && png is null && OperatingSystem.IsWindows()) png = ReadWindowsImage();
        return new MediaInputContent(files, png, text);
    }

    public static MediaInputContent ReadDrop(IDataTransfer data)
    {
        var files = FilterFiles(data.TryGetFiles());
        byte[]? png = null;
        if (files.Count == 0)
        {
            using var bitmap = data.TryGetBitmap();
            if (bitmap is not null) { using var output = new MemoryStream(); bitmap.Save(output); png = output.ToArray(); }
        }
        var text = data.TryGetText() ?? data.TryGetValue(DataFormat.CreateStringPlatformFormat("text/uri-list"));
        if (string.IsNullOrEmpty(text) && OperatingSystem.IsWindows())
        {
            var url = data.TryGetValue(DataFormat.CreateBytesPlatformFormat("UniformResourceLocatorW"));
            if (url is not null) text = Encoding.Unicode.GetString(url).TrimEnd('\0');
        }
        return new MediaInputContent(files, png, text ?? "");
    }

    private static IReadOnlyList<IStorageFile> FilterFiles(IEnumerable<IStorageItem>? files) => files?.OfType<IStorageFile>()
        .Where(file => MediaAttachments.IsSupportedFileName(file.Name)).Take(MediaAttachments.MaxFiles).ToArray() ?? Array.Empty<IStorageFile>();

    private static byte[]? ReadWindowsImage()
    {
        if (!OpenClipboard(0)) return null;
        try
        {
            // Snipping ToolやブラウザーのPNGと、従来アプリのDIBの両方を受け取る。
            var png = ClipboardBytes(RegisterClipboardFormat("PNG"));
            if (png is { Length: > 8 } && png.AsSpan(0, 4).SequenceEqual(new byte[] { 137, 80, 78, 71 })) return png;
            var dib = ClipboardBytes(17) ?? ClipboardBytes(8);
            if (dib is null || dib.Length < 40) return null;
            var header = BinaryPrimitives.ReadInt32LittleEndian(dib);
            if (header < 40 || header > dib.Length) return null;
            var bits = BinaryPrimitives.ReadUInt16LittleEndian(dib.AsSpan(14));
            var compression = BinaryPrimitives.ReadUInt32LittleEndian(dib.AsSpan(16));
            var colors = BinaryPrimitives.ReadUInt32LittleEndian(dib.AsSpan(32));
            if (bits <= 8 && colors == 0) colors = 1u << bits;
            if (colors > 65536) return null;
            var masks = header == 40 ? compression == 3 ? 12 : compression == 6 ? 16 : 0 : 0;
            var offset = 14L + header + masks + colors * 4L;
            if (offset >= dib.Length + 14L) return null;
            var bmp = new byte[dib.Length + 14]; bmp[0] = (byte)'B'; bmp[1] = (byte)'M';
            BinaryPrimitives.WriteInt32LittleEndian(bmp.AsSpan(2), bmp.Length);
            BinaryPrimitives.WriteInt32LittleEndian(bmp.AsSpan(10), (int)offset);
            Buffer.BlockCopy(dib, 0, bmp, 14, dib.Length);
            using var bitmap = SKBitmap.Decode(bmp); if (bitmap is null) return null;
            using var image = SKImage.FromBitmap(bitmap); using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
            return encoded.ToArray();
        }
        finally { CloseClipboard(); }
    }

    private static byte[]? ClipboardBytes(uint format)
    {
        var handle = GetClipboardData(format); if (handle == 0) return null;
        var length = GlobalSize(handle).ToInt64(); if (length <= 0 || length > 256L * 1024 * 1024) return null;
        var pointer = GlobalLock(handle); if (pointer == 0) return null;
        try { var data = new byte[(int)length]; Marshal.Copy(pointer, data, 0, data.Length); return data; }
        finally { GlobalUnlock(handle); }
    }

    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenClipboard(nint owner);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseClipboard();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] private static extern nint GetClipboardData(uint format);
    [DllImport("kernel32.dll")] private static extern nint GlobalSize(nint memory);
    [DllImport("kernel32.dll")] private static extern nint GlobalLock(nint memory);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GlobalUnlock(nint memory);
}
