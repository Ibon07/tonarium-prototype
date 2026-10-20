namespace Tonarium.Desktop.Views;

public sealed record ItemInfo(string Kind, string Name, string Mark, string Tint, string Ink, string Description, bool In2d = true, bool In3d = true, bool Media = false);

public static class ItemCatalog
{
    public static readonly ItemInfo[] All =
    [
        new("note", "付箋", "付", "#FBF1C4", "#7A5B0E", "文字を書いて、みんなに残せる付箋。"),
        new("hammer", "ピコピコハンマー", "槌", "#FBE3D2", "#A24A16", "手に持って、近くの人をつんつん。"),
        new("chess", "チェス", "♟", "#E3E7F6", "#2F4A9C", "みんなで一つの盤面を囲むチェス。"),
        new("chessAi", "チェスAI", "♟AI", "#DFEEE8", "#2E6E4E", "白はみんな、黒はAI。"),
        new("g2048", "2048", "2048", "#F4EBCF", "#7A5B0E", "同じ数字を合わせる共有パズル。", true, false),
        new("canvas", "キャンバス", "画", "#F6E4EC", "#9A3A62", "ペンと消しゴムで、一緒にお絵描き。"),
        new("camera", "カメラ", "写", "#E5F0E9", "#2E6E4E", "3D空間を撮影・ライブ配信。", false),
        new("dice", "サイコロ", "賽", "#F3E6D3", "#7A4A22", "d4〜d100、最大10個。秘密のロールも。"),
        new("image", "画像", "絵", "#E4EEF7", "#2F5E8C", "みんなと共有した画像。", Media: true),
        new("video", "動画", "動", "#EFE4F6", "#6A3A8C", "同じところを一緒に再生。", Media: true),
        new("youtube", "YouTube", "YT", "#FBE1DE", "#B3261E", "YouTubeをみんなで視聴。", Media: true),
    ];

    public static ItemInfo Get(string kind) => All.FirstOrDefault(x => x.Kind == kind) ?? new(kind, kind, "◇", "#EEEAF4", "#51465D", "共有アイテム");
}
