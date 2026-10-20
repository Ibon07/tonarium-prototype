using System.Text.Json.Nodes;
using Avalonia.Controls;
using Avalonia.Platform.Storage;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed partial class RoomView
{
    public async Task PasteMediaAsync(TextBox? textTarget = null)
    {
        var clipboard = _ctx.Owner.Clipboard;
        if (clipboard is null) return;
        var content = await MediaInput.ReadClipboardAsync(clipboard);
        if (content.HasMedia) await DropMediaAsync(content);
        else if (textTarget is not null) textTarget.Paste();
        else if (content.YouTubeId is { } id) await ShareYouTubeAsync(id);
    }

    public async Task DropMediaAsync(MediaInputContent content)
    {
        if (_ctx.State.SessionId is null) return;
        var asItem = _ctx.State.Mode == "3d" && _conversation is null;
        if (content.Files.Count > 0) await ShareMediaFilesAsync(content.Files, asItem, false);
        else if (content.PngBytes is { Length: > 0 } bytes)
        {
            var target = CaptureMediaTarget(false);
            _ctx.Notify("画像をアップロードしています…");
            var media = await MediaAttachments.UploadBytesAsync(target.Server, bytes);
            await SendAttachmentAsync(media, target, asItem);
            _ctx.Notify("画像を共有しました");
        }
        else if (content.YouTubeId is { } id) await ShareYouTubeAsync(id);
    }

    public async Task DropMediaPathsAsync(IEnumerable<string> paths)
    {
        var files = new List<IStorageFile>();
        foreach (var path in paths.Take(MediaAttachments.MaxFiles))
            if (Path.IsPathFullyQualified(path) && MediaAttachments.IsSupportedFileName(path) &&
                await _ctx.Owner.StorageProvider.TryGetFileFromPathAsync(new Uri(path)) is { } file) files.Add(file);
        await DropMediaAsync(new MediaInputContent(files, null, ""));
    }

    private sealed record MediaTarget(string Server, string Identity, string? Session, string? Conversation, string Text, string Scope);

    private MediaTarget CaptureMediaTarget(bool useDraft) => new(_ctx.State.ServerUrl, _ctx.State.SelfId, _ctx.State.SessionId, _conversation,
        useDraft ? _input.Text?.Trim() ?? "" : "", useDraft ? _scopeIndex == 1 ? "all" : _scopeIndex == 2 ? "announce" : "near" : "all");

    private async Task ShareMediaFilesAsync(IEnumerable<IStorageFile> files, bool asItem, bool useDraft)
    {
        var target = CaptureMediaTarget(useDraft);
        var attachments = files.Where(f => MediaAttachments.IsSupportedFileName(f.Name)).Take(MediaAttachments.MaxFiles).ToArray();
        if (attachments.Length == 0) return;
        _ctx.Notify("添付をアップロードしています…");
        var sent = 0;
        foreach (var file in attachments)
        {
            try
            {
                var media = await MediaAttachments.UploadAsync(target.Server, file);
                await SendAttachmentAsync(media, target, asItem);
                sent++;
                if (useDraft && _input.Text?.Trim() == target.Text && _conversation == target.Conversation) _input.Text = "";
                target = target with { Text = "" };
            }
            catch (Exception error) { _ctx.Notify(file.Name + ": " + error.Message); }
        }
        if (sent > 0) _ctx.Notify(sent == attachments.Length ? "添付を共有しました" : $"添付を {sent}/{attachments.Length} 件共有しました");
    }

    private async Task SendAttachmentAsync(JsonObject media, MediaTarget target, bool asItem)
    {
        // アップロード中に移動した部屋や会話へ誤送信しない。
        if (target.Server != _ctx.State.ServerUrl || target.Identity != _ctx.State.SelfId || target.Session != _ctx.State.SessionId || target.Conversation != _conversation)
            throw new InvalidOperationException("送信先が変わったため、添付を送信しませんでした。");
        if (target.Conversation is not null)
            await _ctx.Client.SendAsync(new { t = "msg", conv = target.Conversation, text = target.Text, media });
        else
        {
            await _ctx.Client.SendRoomAsync(new { t = "chat", text = target.Text, scope = target.Scope, media });
            if (asItem) await SpawnAsync(J.Text(media, "kind"), media);
        }
    }

    private async Task ShareYouTubeAsync(string id)
    {
        var url = MediaAttachments.YouTubeUrl(id);
        if (_conversation is not null) await _ctx.Client.SendAsync(new { t = "msg", conv = _conversation, text = url });
        else
        {
            await _ctx.Client.SendRoomAsync(new { t = "chat", text = url, scope = "all" });
            if (_ctx.State.Mode == "3d") await SpawnAsync("youtube", new { videoId = id, title = "YouTube" });
        }
    }

    private async Task ItemizeMessageAsync(JsonNode message)
    {
        if (message["media"] is JsonObject media) { await SpawnAsync(J.Text(media, "kind"), media); return; }
        if (MediaAttachments.TryYouTubeId(J.Text(message, "text")) is { } id)
        { await SpawnAsync("youtube", new { videoId = id, title = "YouTube" }); return; }
        var image = J.Text(message, "image");
        if (image.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
        {
            var comma = image.IndexOf(',');
            if (comma < 0 || !image[..comma].EndsWith(";base64", StringComparison.OrdinalIgnoreCase)) return;
            var uploaded = await MediaAttachments.UploadBytesAsync(_ctx.State.ServerUrl, Convert.FromBase64String(image[(comma + 1)..]));
            await SpawnAsync("image", uploaded);
        }
        else if (image.Length > 0) await SpawnAsync("image", new { kind = "image", url = image });
    }
}
