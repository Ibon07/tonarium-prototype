using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Platform;
using Avalonia.Threading;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;

namespace Tonarium.Desktop.Views;

/// <summary>The persistent native room shell. Input and scroll controls survive realtime updates.</summary>
public sealed class RoomView : UserControl
{
    private readonly NativeContext _ctx;
    private readonly Grid _root = new();
    private readonly StackPanel _players = new() { Spacing = 5 };
    private readonly StackPanel _items = new() { Spacing = 5 };
    private readonly StackPanel _faces = new() { Spacing = 14, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _logs = new() { Spacing = 12 };
    private readonly StackPanel _notices = new() { Spacing = 7 };
    private readonly StackPanel _status = new() { Spacing = 5, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly ScrollViewer _logScroll;
    private readonly TextBlock _worldName = Ui.Text("", 15);
    private readonly TextBlock _playerCount = Ui.Text("", 12, Ui.Muted);
    private readonly TextBlock _itemCount = Ui.Text("", 12, Ui.Muted);
    private readonly TextBox _input = Ui.Input("声の届く範囲（〜15m）に送信");
    private readonly ComboBox _scope = new() { ItemsSource = new[] { "声の範囲", "全体", "アナウンス" }, SelectedIndex = 0, MinWidth = 120 };
    private readonly Button _mic;
    private readonly Button _share;
    private readonly Button _mode;
    private readonly Border _left;
    private readonly Border _right;
    private readonly Button _leftFold;
    private readonly Button _rightFold;
    private readonly Border _center;
    private string _playersSignature = "", _itemsSignature = "", _chatSignature = "", _noticeSignature = "", _statusSignature = "";
    private bool _leftHidden, _rightHidden, _facesHidden, _chatOnly;
    private string? _conversation;
    private readonly Dictionary<string, TextBlock> _distanceLabels = new();
    private readonly Dictionary<string, (double X, double Z, double Yaw)> _places = new();
    private static readonly HttpClient Http = new();
    private static readonly Dictionary<string, Bitmap> IconCache = new();
    private static readonly Dictionary<string, (string Name, string Mark, string Tint)> ItemInfo = new()
    {
        ["note"] = ("付箋", "付", "#FBF1C4"), ["hammer"] = ("ピコピコハンマー", "槌", "#FBE3D2"),
        ["chess"] = ("チェス", "♟", "#E3E7F6"), ["chessAi"] = ("チェスAI", "♟", "#DFEEE8"),
        ["g2048"] = ("2048", "2048", "#F4EBCF"), ["canvas"] = ("キャンバス", "画", "#F6E4EC"),
        ["camera"] = ("カメラ", "写", "#E5F0E9"), ["dice"] = ("サイコロ", "賽", "#F3E6D3"),
        ["image"] = ("画像", "絵", "#E4EEF7"), ["video"] = ("動画", "動", "#EFE4F6"), ["youtube"] = ("YouTube", "YT", "#FBE1DE")
    };

    public RoomView(NativeContext context)
    {
        _ctx = context;
        _leftHidden = NativeSettings.GetBool("room.leftFolded");
        _rightHidden = NativeSettings.GetBool("room.rightFolded");
        _facesHidden = NativeSettings.GetBool("room.facesFolded");
        Background = Brush.Parse("#EAE5DB");
        _root.Children.Add(new RoomBackdrop { IsHitTestVisible = false });
        Content = _root;

        var head = Ui.Row(Small("☰", () => _ctx.ShowHome("home")), _worldName, Small("⚙", Settings));
        var headCard = Panel(head); headCard.Margin = new Thickness(20, 18, 0, 0); headCard.HorizontalAlignment = HorizontalAlignment.Left; headCard.VerticalAlignment = VerticalAlignment.Top;
        _root.Children.Add(headCard);

        var leftContent = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto,0.7*") };
        var ph = Ui.Row(Ui.Text("プレイヤー", 15), _playerCount, Small("‹", ToggleLeft));
        ph.Margin = new Thickness(3, 0, 3, 8);
        leftContent.Children.Add(ph);
        var playerScroll = new ScrollViewer { Content = _players, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        Grid.SetRow(playerScroll, 1); leftContent.Children.Add(playerScroll);
        var ih = Ui.Row(Ui.Text("アイテム", 15), _itemCount, Small("＋ 出す", ItemPicker));
        ih.Margin = new Thickness(3, 15, 3, 8); Grid.SetRow(ih, 2); leftContent.Children.Add(ih);
        var itemScroll = new ScrollViewer { Content = _items, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        Grid.SetRow(itemScroll, 3); leftContent.Children.Add(itemScroll);
        _left = Panel(leftContent); _left.Width = 308; _left.Margin = new Thickness(20, 78, 0, 20); _left.HorizontalAlignment = HorizontalAlignment.Left;
        _root.Children.Add(_left);
        _leftFold = Small("›\n人\n箱", ToggleLeft); _leftFold.Margin = new Thickness(20, 80, 0, 0); _leftFold.HorizontalAlignment = HorizontalAlignment.Left; _leftFold.VerticalAlignment = VerticalAlignment.Top; _leftFold.IsVisible = _leftHidden; _left.IsVisible = !_leftHidden;
        _root.Children.Add(_leftFold);

        var rightContent = new Grid { RowDefinitions = new RowDefinitions("Auto,Auto,Auto,*,Auto,Auto") };
        var tabs = Ui.Row(Small("通知・ログ", () => { _conversation = null; _chatSignature = ""; Refresh(); }), Small("メッセージ", Conversations), Small("›", ToggleRight));
        rightContent.Children.Add(tabs);
        var noticeScroll = new ScrollViewer { Content = _notices, MaxHeight = 165, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Margin = new Thickness(0, 12, 0, 12) };
        Grid.SetRow(noticeScroll, 1); rightContent.Children.Add(noticeScroll);
        var logHead = Ui.Row(Ui.Text("ログ", 14), Small("すべて", () => { _chatOnly = false; _chatSignature = ""; Refresh(); }), Small("チャット", () => { _chatOnly = true; _chatSignature = ""; Refresh(); }));
        Grid.SetRow(logHead, 2); rightContent.Children.Add(logHead);
        _logScroll = new ScrollViewer { Content = _logs, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Margin = new Thickness(0, 12, 0, 10) };
        Grid.SetRow(_logScroll, 3); rightContent.Children.Add(_logScroll);
        Grid.SetRow(_scope, 4); _scope.Margin = new Thickness(0, 5, 0, 6); rightContent.Children.Add(_scope);
        _scope.SelectionChanged += (_, _) => _input.PlaceholderText = _scope.SelectedIndex == 0 ? "声の届く範囲（〜15m）に送信" : _scope.SelectedIndex == 1 ? "セッション全体に送信" : "アナウンスを送信";
        var compose = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        var attach = Small("＋", () => Run(() => AttachAsync())); compose.Children.Add(attach);
        _input.MinWidth = 0; _input.AcceptsReturn = true; _input.MaxHeight = 100;
        Grid.SetColumn(_input, 1); compose.Children.Add(_input);
        var send = Small("➤", () => Run(SendChatAsync)); Grid.SetColumn(send, 2); compose.Children.Add(send);
        // Enter sends, Shift+Enter creates a newline. IME text composition remains owned by the native TextBox.
        _input.KeyDown += (_, e) => { if (e.Key == Key.Enter && !e.KeyModifiers.HasFlag(KeyModifiers.Shift)) { e.Handled = true; Run(SendChatAsync); } };
        Grid.SetRow(compose, 5); rightContent.Children.Add(compose);
        _right = Panel(rightContent); _right.Width = 304; _right.Margin = new Thickness(0, 18, 20, 20); _right.HorizontalAlignment = HorizontalAlignment.Right;
        _root.Children.Add(_right);
        _rightFold = Small("‹\n通知\nログ", ToggleRight); _rightFold.Margin = new Thickness(0, 20, 20, 0); _rightFold.HorizontalAlignment = HorizontalAlignment.Right; _rightFold.VerticalAlignment = VerticalAlignment.Top; _rightFold.IsVisible = _rightHidden; _right.IsVisible = !_rightHidden;
        _root.Children.Add(_rightFold);

        var centerStack = new StackPanel { Spacing = 20, HorizontalAlignment = HorizontalAlignment.Center };
        centerStack.Children.Add(_faces);
        var faceFold = Small("⌃ 顔をたたむ / 開く", () => { _facesHidden = !_facesHidden; NativeSettings.SetBool("room.facesFolded", _facesHidden); _playersSignature = ""; Refresh(); });
        faceFold.HorizontalAlignment = HorizontalAlignment.Center; centerStack.Children.Add(faceFold);
        _mode = Ui.Button("3D 空間に入る  ↗", () => Run(() => _ctx.ChangeModeAsync(_ctx.State.Mode == "3d" ? "2d" : "3d")));
        _mode.HorizontalAlignment = HorizontalAlignment.Center; _mode.Padding = new Thickness(22, 12); centerStack.Children.Add(_mode);
        _mode.Background = Brush.Parse("#2F5FC4"); _mode.Foreground = Brushes.White;
        _center = new Border { Child = centerStack, Margin = new Thickness(345, 140, 340, 140), VerticalAlignment = VerticalAlignment.Center };
        _root.Children.Add(_center);

        _mic = Ui.Button("♩ マイク", () => Run(() => _ctx.Media.SetMicrophoneAsync(!_ctx.State.MicOn)));
        _share = Ui.Button("▣ 画面共有", () => Run(() => _ctx.Media.SetScreenShareAsync(!_ctx.State.Sharing)));
        var dock = Ui.Row(_mic, _share, Small("♫", Soundboard), Small("▱", WindowOptions), Small("退出 ↗", () => Run(() => _ctx.Client.LeaveAsync())));
        dock.Spacing = 7;
        foreach (var button in dock.Children.OfType<Button>()) { button.Foreground = Brushes.White; button.Background = Brush.Parse("#3A3B44"); }
        var bottom = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(80, 0, 80, 20) };
        var dockPanel = Panel(dock); dockPanel.Background = Brush.Parse("#26262E"); dockPanel.BorderBrush = Brush.Parse("#44454F"); dockPanel.Padding = new Thickness(8);
        bottom.Children.Add(_status); bottom.Children.Add(dockPanel); _root.Children.Add(bottom);
        SizeChanged += (_, _) => Fit();
        Refresh();
    }

    public void Refresh()
    {
        var s = _ctx.State;
        ComputePlaces();
        var users = Participants();
        _worldName.Text = J.Text(s.Sessions.FirstOrDefault(x => J.Text(x, "id") == s.SessionId), "name", "セッション") + (s.Broadcast ? "  ◉" : "");
        _playerCount.Text = users.Count.ToString(); _itemCount.Text = s.Items.Count.ToString();
        _mic.Content = s.MicOn ? "♩ マイク ON" : "♩ ミュート";
        _mic.Background = Brush.Parse(s.MicOn ? "#3A3B44" : "#743F3B");
        _share.Content = s.Sharing ? "▣ 共有を停止" : "▣ 画面共有";
        _mode.Content = s.Mode == "3d" ? "2D に戻る" : "3D 空間に入る  ↗";
        // Distance bands affect ordering; the numeric labels update without replacing row controls.
        var pkey = string.Join("|", users.OrderBy(Distance).Select(u => $"{J.Text(u, "id")}:{J.Text(u, "name")}:{J.Text(u, "mode")}:{J.Text(u, "follow")}:{J.Bool(u, "micOn")}:{J.Bool(u, "sharing")}:{J.Text(u, "icon")}:{J.Text(u, "avatar")}:{J.Bool(u, "speaking")}:{Band(Distance(u))}")) + _facesHidden + s.Mode;
        if (pkey != _playersSignature) { _playersSignature = pkey; RebuildPlayers(users); RebuildFaces(users); }
        foreach (var (id, label) in _distanceLabels) label.Text = FormatDistance(DistanceId(id));
        var ikey = string.Join("|", s.Items.Select(p => $"{p.Key}:{J.Text(p.Value, "kind")}:{J.Text(p.Value, "text")}:{J.Text(p.Value, "holder")}:{J.Bool(p.Value, "live")}:{Band(ItemDistance(p.Value))}"));
        if (ikey != _itemsSignature) { _itemsSignature = ikey; RebuildItems(); }
        var chats = _conversation is null ? s.Chats : J.Array(s.Conversations, _conversation);
        var blocked = string.Join("|", NativeSettings.BlockedNames.OrderBy(x => x));
        var ckey = chats.ToJsonString() + _conversation + _chatOnly + blocked;
        if (ckey != _chatSignature) { _chatSignature = ckey; RebuildChat(chats); RebuildFaces(users); }
        var nkey = s.Notifications.ToJsonString() + blocked;
        if (nkey != _noticeSignature) { _noticeSignature = nkey; RebuildNotices(); }
        var me = users.FirstOrDefault(u => J.Text(u, "id") == s.SelfId);
        var st = $"{s.ConnectionStatus}|{s.SyncStatus}|{J.Text(me, "follow")}|{J.Object(me, "pos").ToJsonString()}|{s.Mode}";
        if (st != _statusSignature) { _statusSignature = st; RebuildStatus(me); }
    }

    private List<JsonNode> Participants() => _ctx.State.Users.Where(x => x is JsonObject && J.Text(x, "session") == _ctx.State.SessionId).Select(x =>
    {
        var user = (JsonObject)x!.DeepClone();
        if (_ctx.State.Presence[J.Text(user, "id")] is JsonObject presence)
            foreach (var (key, value) in presence) user[key] = value?.DeepClone();
        if (_ctx.Media is NativeMedia media) user["speaking"] = media.IsSpeaking(J.Text(user, "id"));
        return (JsonNode)user;
    }).ToList();
    private void ComputePlaces()
    {
        _places.Clear(); var queue = 0; var users = Participants();
        foreach (var u in users.Where(u => J.Text(u, "mode") == "3d"))
        { var id = J.Text(u, "id"); var a = _ctx.State.Avatars[id]; _places[id] = (J.Number(a, "x"), J.Number(a, "z"), J.Number(a, "ry")); }
        var following = new Dictionary<string, int>();
        foreach (var u in users.Where(u => J.Text(u, "mode") != "3d"))
        {
            var id = J.Text(u, "id"); var target = J.Text(u, "follow");
            if (_places.TryGetValue(target, out var t)) { var i = following.GetValueOrDefault(target); following[target] = i + 1; var side = (i % 2 == 1 ? -1 : 1) * Math.Ceiling(i / 2d) * .45; var back = .9 + Math.Floor(i / 3d) * .35; _places[id] = (t.X + Math.Sin(t.Yaw) * back + Math.Cos(t.Yaw) * side, t.Z + Math.Cos(t.Yaw) * back - Math.Sin(t.Yaw) * side, t.Yaw); }
            else if (u["pos"] is JsonObject pos) _places[id] = (J.Number(pos, "x"), J.Number(pos, "z"), J.Number(pos, "ry"));
            else { var r = .45 * Math.Sqrt(queue); var angle = queue * 2.39996; _places[id] = (Math.Sin(angle) * r, 6.5 + Math.Cos(angle) * r, 0); queue++; }
        }
    }
    private double Distance(JsonNode u) => DistanceId(J.Text(u, "id"));
    private double DistanceId(string id)
    {
        var self = _places.GetValueOrDefault(_ctx.State.SelfId);
        if (!_places.TryGetValue(id, out var p)) return 0;
        return Math.Sqrt(Math.Pow(self.X - p.X, 2) + Math.Pow(self.Z - p.Z, 2));
    }
    private double ItemDistance(JsonNode? item)
    {
        var holder = J.Text(item, "holder"); if (holder != "") return DistanceId(holder);
        var me = _places.GetValueOrDefault(_ctx.State.SelfId);
        return Math.Sqrt(Math.Pow(J.Number(item, "x") - me.X, 2) + Math.Pow(J.Number(item, "z") - me.Z, 2));
    }
    private static int Band(double d) => d <= 3 ? 0 : d <= 15 ? 1 : 2;
    private static string FormatDistance(double d) => d < .1 ? "すぐそば" : $"{d:0.0}m";
    private static Control BandLabel(int band) => Ui.Text(band == 0 ? "● すぐそば    〜3m" : band == 1 ? "● 声が届く    〜15m" : "● とおく    15m〜", 11, band == 0 ? "#438669" : band == 1 ? "#B18C3D" : Ui.Muted);

    private void RebuildPlayers(List<JsonNode> users)
    {
        _players.Children.Clear(); _distanceLabels.Clear();
        var self = users.FirstOrDefault(u => J.Text(u, "id") == _ctx.State.SelfId);
        if (self is not null) _players.Children.Add(PlayerRow(self, true));
        var others = users.Where(u => J.Text(u, "id") != _ctx.State.SelfId).OrderBy(Distance).ToList();
        for (var band = 0; band < 3; band++)
        {
            var entries = others.Where(u => Band(Distance(u)) == band).ToList(); if (entries.Count == 0) continue;
            _players.Children.Add(BandLabel(band));
            foreach (var u in entries) _players.Children.Add(PlayerRow(u, false));
        }
        if (others.Count == 0) _players.Children.Add(Empty("まだ誰もいません"));
    }
    private Control PlayerRow(JsonNode user, bool self)
    {
        var id = J.Text(user, "id"); var name = J.Text(user, "name");
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("34,*,Auto,Auto"), Margin = new Thickness(0, 3) };
        var face = Face(user, 30); row.Children.Add(face);
        var label = Ui.Column(Ui.Text(name + (self ? "  あなた" : ""), 13), Ui.Text(J.Text(user, "mode", "2d").ToUpperInvariant() + (!J.Bool(user, "micOn") ? " · ミュート" : "") + (J.Text(user, "follow") != "" ? " · ついていく" : ""), 10, Ui.Muted));
        var nameButton = Ui.Button("", () => PickUser(id)); nameButton.Content = label; nameButton.Padding = new Thickness(4); nameButton.Background = Brushes.Transparent; nameButton.BorderThickness = new Thickness(0); nameButton.HorizontalContentAlignment = HorizontalAlignment.Left; Grid.SetColumn(nameButton, 1); row.Children.Add(nameButton);
        if (J.Bool(user, "sharing")) { var live = Small("LIVE", () => OpenLive(id)); Grid.SetColumn(live, 2); row.Children.Add(live); }
        else { var dist = Ui.Text(self ? "" : FormatDistance(Distance(user)), 10, Ui.Muted); dist.VerticalAlignment = VerticalAlignment.Center; if (!self) _distanceLabels[id] = dist; Grid.SetColumn(dist, 2); row.Children.Add(dist); }
        var more = Small("⋯", () => UserMenu(user)); Grid.SetColumn(more, 3); row.Children.Add(more);
        var card = new Border { Child = row, Padding = new Thickness(5), CornerRadius = new CornerRadius(12), Background = self ? Brush.Parse("#EFECE6") : Brushes.Transparent };
        if (J.Text(user, "follow") != "") card.Margin = new Thickness(14, 0, 0, 0);
        return card;
    }
    private void PickUser(string id)
    {
        var held = _ctx.State.Items.FirstOrDefault(p => J.Text(p.Value, "kind") == "hammer" && J.Text(p.Value, "holder") == _ctx.State.SelfId);
        if (held.Key is not null && id != _ctx.State.SelfId) Run(async () => { await _ctx.Client.SendRoomAsync(new { t = "hit", to = id }); await GoNearAsync(id); });
        else _ctx.OpenProfile(id);
    }
    private void UserMenu(JsonNode user)
    {
        var id = J.Text(user, "id"); var box = Ui.Column(Ui.Title(J.Text(user, "name")), Ui.Button("プロフィール", () => _ctx.OpenProfile(id)), Ui.Button("そばにいく", () => Run(() => GoNearAsync(id))), Ui.Button("つんつん", () => SendRoom(new { t = "poke", to = id })));
        if (J.Text(user, "mode") == "3d" && id != _ctx.State.SelfId) box.Children.Add(Ui.Button("ついていく / やめる", () => { var me = Participants().FirstOrDefault(x => J.Text(x, "id") == _ctx.State.SelfId); SendRoom(new { t = "follow", target = J.Text(me, "follow") == id ? null : id }); }));
        ShowPopup(box, 310);
    }
    private void RebuildFaces(List<JsonNode> users)
    {
        _faces.Children.Clear(); if (_facesHidden) { _faces.Children.Add(Ui.Text($"近くに {users.Count} 人", 15, Ui.Muted)); return; }
        var visible = users.OrderBy(u => J.Text(u, "id") == _ctx.State.SelfId ? -1 : Distance(u)).Where(u => Distance(u) <= 15).Take(6).ToList();
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = 520 };
        foreach (var u in visible)
        {
            var id = J.Text(u, "id"); var color = UserColor(id);
            var portrait = new RoomPortrait(color) { Height = 135, Width = 160 };
            LoadPortrait(portrait, u);
            var grid = new Grid(); grid.Children.Add(portrait);
            var bottom = Ui.Row(Ui.Text(J.Text(u, "name"), 12, "#FFFFFF"), Ui.Text(J.Text(u, "mode", "2d").ToUpperInvariant(), 10, "#EAE7EE"));
            var bar = new Border { Background = Brush.Parse("#BB26262E"), CornerRadius = new CornerRadius(8), Padding = new Thickness(8, 5), Child = bottom, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(7) }; grid.Children.Add(bar);
            var last = _ctx.State.Chats.LastOrDefault(m => J.Text(m, "from") == id && J.Text(m, "text") != "" && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - J.Number(m, "at") < 30000);
            if (last is not null) { var bubble = new Border { Background = Brushes.White, CornerRadius = new CornerRadius(8), Padding = new Thickness(6), Child = Ui.Text(J.Text(last, "text"), 11), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(7) }; grid.Children.Add(bubble); }
            var button = Ui.Button("", () => OpenPortrait(u)); button.Content = new Border { Child = grid, CornerRadius = new CornerRadius(15), ClipToBounds = true }; button.Padding = new Thickness(0); button.Margin = new Thickness(5); button.Background = Brush.Parse(color); button.BorderThickness = new Thickness(J.Bool(u, "speaking") ? 3 : 0); button.BorderBrush = Brush.Parse("#2E9A64"); button.CornerRadius = new CornerRadius(15); button.ClipToBounds = true; wrap.Children.Add(button);
        }
        _faces.Children.Add(wrap);
    }
    private void RebuildItems()
    {
        _items.Children.Clear();
        var sorted = _ctx.State.Items.OrderBy(p => ItemDistance(p.Value)); var lastBand = -1;
        foreach (var (id, item) in sorted)
        {
            var band = Band(ItemDistance(item)); if (band != lastBand) { lastBand = band; _items.Children.Add(BandLabel(band)); }
            var kind = J.Text(item, "kind"); var info = ItemInfo.GetValueOrDefault(kind, (Name: kind, Mark: "□", Tint: "#EFEAE3"));
            var mark = new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(9), Background = Brush.Parse(info.Tint), Child = CenterText(info.Mark, 12) };
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("36,*,Auto,Auto"), Margin = new Thickness(2, 4) }; row.Children.Add(mark);
            var name = kind == "note" ? J.Text(item, "text", "付箋（空）").Split('\n')[0] : kind == "youtube" ? J.Text(item, "title", info.Name) : info.Name;
            if (name.Length > 17) name = name[..17] + "…";
            var open = Small(name, () => _ctx.OpenItem("item:" + id)); Grid.SetColumn(open, 1); row.Children.Add(open);
            if (kind != "hammer") { var ob = Small("開く", () => _ctx.OpenItem("item:" + id)); Grid.SetColumn(ob, 2); row.Children.Add(ob); }
            var menu = Small("⋯", () => ItemMenu(id)); Grid.SetColumn(menu, 3); row.Children.Add(menu); _items.Children.Add(row);
        }
        if (_items.Children.Count == 0) _items.Children.Add(Empty("「出す」からアイテムを置けます"));
    }
    private void ItemMenu(string id)
    {
        var it = _ctx.State.Items[id]; var holder = J.Text(it, "holder"); var kind = J.Text(it, "kind");
        var box = Ui.Column(Ui.Title(ItemInfo.GetValueOrDefault(kind, (Name: kind, Mark: "", Tint: "")).Name), Ui.Button("ウィンドウを開く", () => _ctx.OpenItem("item:" + id)), Ui.Button("そばにいく", () => Run(() => GoNearAsync("item:" + id))), Ui.Button("✦ 注目を集める", () => SendRoom(new { t = "attention", key = "item:" + id })));
        if (kind is "hammer" or "camera") box.Children.Add(Ui.Button(holder == _ctx.State.SelfId ? "手放す" : "手に持つ", () => { var p = _places.GetValueOrDefault(_ctx.State.SelfId); if (holder == _ctx.State.SelfId) SendRoom(new { t = "itemAction", id, action = new { a = "drop", x = p.X, z = p.Z - 1, ry = p.Yaw } }); else SendRoom(new { t = "itemAction", id, action = new { a = "pick" } }); }));
        if (holder == "") box.Children.Add(Ui.Button("しまう", () => SendRoom(new { t = "itemRemove", id })));
        ShowPopup(box, 300);
    }
    private void ItemPicker()
    {
        var wrap = new WrapPanel { MaxWidth = 450 }; var title = Ui.Title("所持アイテム", "一緒に遊ぶものを、目の前に出す");
        foreach (var (kind, info) in ItemInfo.Where(p => p.Key is not ("image" or "video" or "youtube")))
        {
            var b = Ui.Button("", () => Run(() => SpawnAsync(kind))); b.Content = Ui.Column(CenterText(info.Mark, 26), CenterText(info.Name, 12)); b.Width = 130; b.Height = 84; b.Margin = new Thickness(5); b.Background = Brush.Parse(info.Tint); b.IsEnabled = kind != "camera" || _ctx.State.Mode == "3d"; wrap.Children.Add(b);
        }
        ShowPopup(Ui.Column(title, wrap, Ui.Button("画像・動画を共有", () => Run(() => AttachAsync(true)))), 470);
    }
    private Task SpawnAsync(string kind, object? media = null)
    {
        var p = _places.GetValueOrDefault(_ctx.State.SelfId);
        return _ctx.Client.SendRoomAsync(new { t = "itemCreate", kind, media, x = Math.Clamp(p.X - Math.Sin(p.Yaw) * 1.2, -9.5, 9.5), z = Math.Clamp(p.Z - Math.Cos(p.Yaw) * 1.2, -9.5, 9.5), ry = p.Yaw });
    }
    private async Task GoNearAsync(string id)
    {
        var me = _places.GetValueOrDefault(_ctx.State.SelfId); (double X, double Z, double Yaw) target;
        if (id.StartsWith("item:")) { var it = _ctx.State.Items[id[5..]]; var holder = J.Text(it, "holder"); target = holder != "" ? _places.GetValueOrDefault(holder) : (J.Number(it, "x"), J.Number(it, "z"), J.Number(it, "ry")); }
        else target = _places.GetValueOrDefault(id);
        var dx = me.X - target.X; var dz = me.Z - target.Z; var len = Math.Sqrt(dx * dx + dz * dz); if (len < .01) { dx = 0; dz = 1; } else { dx /= len; dz /= len; }
        var x = Math.Clamp(target.X + dx, -9.5, 9.5); var z = Math.Clamp(target.Z + dz, -9.5, 9.5); var ry = Math.Atan2(-(target.X - x), -(target.Z - z));
        if (_ctx.State.Mode == "3d") await _ctx.TeleportAsync(x, z, ry);
        else await _ctx.Client.SendRoomAsync(new { t = "place2d", target = _ctx.State.SelfId, pos = new { x, z, ry } });
    }
    private async Task SendChatAsync()
    {
        var text = _input.Text?.Trim() ?? ""; if (text.Length == 0) return;
        if (_conversation is not null) await _ctx.Client.SendAsync(new { t = "msg", conv = _conversation, text });
        else await _ctx.Client.SendRoomAsync(new { t = "chat", text, scope = _scope.SelectedIndex == 1 ? "all" : _scope.SelectedIndex == 2 ? "announce" : "near" });
        _input.Text = "";
    }
    private void RebuildChat(JsonArray chats)
    {
        var atBottom = _logScroll.Offset.Y >= _logScroll.Extent.Height - _logScroll.Viewport.Height - 50;
        var oldOffset = _logScroll.Offset; _logs.Children.Clear();
        foreach (var m in chats.Where(m => (!_chatOnly || J.Text(m, "from") != "") && !NativeSettings.BlockedNames.Contains(J.Text(m, "fromName", J.Text(m, "from")))).TakeLast(150))
        {
            var from = J.Text(m, "fromName", J.Text(m, "from")); var text = J.Text(m, "text");
            if (from == "") { _logs.Children.Add(Ui.Text(text, 11, Ui.Muted)); continue; }
            var top = Ui.Row(Ui.Text(from, 12, Ui.Purple), Ui.Text(Time(J.Number(m, "at")), 10, Ui.Muted));
            var scope = J.Text(m, "scope"); if (scope is "all" or "announce") top.Children.Add(Ui.Text(scope == "all" ? "全体" : "アナウンス", 10, Ui.Orange));
            var body = Ui.Column(top); if (text.Length > 0) body.Children.Add(new SelectableTextBlock { Text = text, FontSize = 13, TextWrapping = TextWrapping.Wrap, Foreground = Brush.Parse("#26262E") });
            var url = Regex.Match(text, @"https?://[^\s<>]+").Value;
            if (url.Length > 0) body.Children.Add(Small("↗ リンクを開く", () => ConfirmLink(url)));
            var dice = m?["dice"]; if (dice is not null) body.Children.Add(Ui.Text("🎲 " + J.Array(dice, "results").ToJsonString(), 14));
            var media = m?["media"]; if (media is not null || J.Text(m, "image") != "") body.Children.Add(Small("▧ " + (J.Text(media, "kind") == "video" ? "動画" : "画像") + "を開く", () => OpenMedia(m!)));
            _logs.Children.Add(body);
        }
        if (_logs.Children.Count == 0) _logs.Children.Add(Empty(_conversation is null ? "ここから会話をはじめよう" : "メッセージはまだありません"));
        Dispatcher.UIThread.Post(() => { if (atBottom) _logScroll.ScrollToEnd(); else _logScroll.Offset = oldOffset; }, DispatcherPriority.Loaded);
    }
    private void OpenMedia(JsonNode message)
    {
        var media = message["media"]; var url = J.Text(media, "url", J.Text(message, "image"));
        if (url == "") return;
        var box = Ui.Column(Ui.Title("共有されたメディア"), Ui.Button("目の前に出す", () => Run(() => SpawnAsync(J.Text(media, "kind", "image"), new { url, w = J.Number(media, "w", 640), h = J.Number(media, "h", 480) }))));
        if (J.Text(media, "kind") == "video")
        {
            var clock = new JsonObject { ["playing"] = false, ["base"] = 0, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            NativeVideoView? player = null;
            player = new NativeVideoView(new Uri(new Uri(_ctx.State.ServerUrl), url).ToString(), action =>
            {
                var node = System.Text.Json.JsonSerializer.SerializeToNode(action)!; var type = J.Text(node, "a");
                clock["base"] = J.Number(node, "pos"); clock["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (type == "mediaPlay") clock["playing"] = true; else if (type == "mediaPause") clock["playing"] = false;
                player!.UpdateClock(clock);
            });
            box.Children.Insert(1, player); var window = new Window(); ConfigurePopup(window, box, 720);
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) }; timer.Tick += (_, _) => player.UpdateClock(clock); timer.Start();
            window.Closed += (_, _) => { timer.Stop(); player.Dispose(); }; window.Show(_ctx.Owner); return;
        }
        if (J.Text(media, "kind") != "video") { var image = new Image { MaxHeight = 450, Stretch = Stretch.Uniform }; box.Children.Insert(1, image); Run(async () => { var bytes = url.StartsWith("data:") ? Convert.FromBase64String(url[(url.IndexOf(',') + 1)..]) : await Http.GetByteArrayAsync(new Uri(new Uri(_ctx.State.ServerUrl), url)); image.Source = new Bitmap(new System.IO.MemoryStream(bytes)); }); }
        ShowPopup(box, 560);
    }
    private void RebuildNotices()
    {
        _notices.Children.Clear();
        var announce = _ctx.State.Chats.LastOrDefault(x => J.Text(x, "scope") == "announce");
        if (announce is not null) _notices.Children.Add(new Border { Background = Brush.Parse(Ui.Ink), CornerRadius = new CornerRadius(12), Padding = new Thickness(10), Child = Ui.Column(Ui.Text("◉ アナウンス", 11, "#D5CEEA"), Ui.Text(J.Text(announce, "text"), 12, "#FFFFFF")) });
        foreach (var n in _ctx.State.Notifications.Where(n => !NativeSettings.BlockedNames.Contains(J.Text(n, "fromName", J.Text(_ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == J.Text(n, "from")), "name")))).TakeLast(30).Reverse())
        {
            var kind = NoticeKind(n); var from = J.Text(n, "from"); var name = J.Text(n, "fromName", J.Text(_ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == from), "name", from));
            var action = kind switch { "poke" => "つんつん返す", "friend" => "承認", "attention" => "開く", "live" => "ライブを始める", "invite" => "参加する", _ => "見る" };
            var line = Ui.Column(Ui.Text(name + " " + NoticeText(kind), 12), Small(action, () => NoticeAction(n!)));
            _notices.Children.Add(line);
        }
        if (_notices.Children.Count == 0) _notices.Children.Add(Empty("通知はありません"));
    }
    private static string NoticeText(string kind) => kind switch { "poke" => "がつんつんしました", "hit" => "がハンマーで叩きました", "friend" => "からフレンド申請", "attention" => "が注目を集めています", "live" => "からライブのリクエスト", "invite" => "から招待が届きました", "askJoin" => "が「行ってもいい？」", _ => "からのお知らせ" };
    private void NoticeAction(JsonNode n)
    {
        var from = J.Text(n, "from"); var key = J.Text(n, "key");
        switch (NoticeKind(n))
        {
            case "poke": SendRoom(new { t = "poke", to = from }); break;
            case "friend": Run(() => _ctx.Client.SendAsync(new { t = "friendAccept", to = from })); break;
            case "attention": _ctx.OpenItem(key); break;
            case "live": SendRoom(new { t = "viewLive", on = true }); break;
            case "invite": if (J.Text(n, "kind") == "session") Run(() => _ctx.Client.JoinAsync(J.Text(n, "targetId"))); else _ctx.ShowHome("groups"); break;
            default: _ctx.OpenProfile(from); break;
        }
    }
    private static string NoticeKind(JsonNode? n) => J.Text(n, "t", J.Text(n, "kind")) switch { "friendRequest" => "friend", "liveRequest" => "live", var kind => kind };
    private void RebuildStatus(JsonNode? me)
    {
        _status.Children.Clear();
        _status.Children.Add(Ui.Text($"● {_ctx.State.ConnectionStatus}   ·   kokosync {_ctx.State.SyncStatus}", 10, Ui.Muted));
        var target = J.Text(me, "follow");
        if (target != "")
        {
            var name = J.Text(Participants().FirstOrDefault(x => J.Text(x, "id") == target), "name", target);
            _status.Children.Add(Panel(Ui.Row(Ui.Text(name + " についていっています", 11), Small("ライブをリクエスト", () => SendRoom(new { t = "liveRequest", to = target })), Small("やめる", () => SendRoom(new { t = "follow", target = (string?)null })))));
        }
        else if (me?["pos"] is JsonObject) _status.Children.Add(Small("⌖ 空間の中にいます · スポーンに戻る", () => SendRoom(new { t = "place2d", target = _ctx.State.SelfId, pos = (object?)null })));
    }
    private void Soundboard()
    {
        var grid = new WrapPanel { MaxWidth = 300 };
        foreach (var (id, label) in new[] { ("clap", "👏 拍手"), ("laugh", "わはは"), ("wow", "おお〜"), ("drum", "ドラム"), ("bell", "チャイム"), ("boo", "ブブー") })
        { var b = Ui.Button(label, () => SendRoom(new { t = "sound", id })); b.Width = 125; b.Margin = new Thickness(5); grid.Children.Add(b); }
        ShowPopup(Ui.Column(Ui.Title("サウンドボード", "近くの人に聞こえます"), grid), 310);
    }
    private void Settings()
    {
        var box = Ui.Column(Ui.Title("セッションの設定"));
        var broadcast = new ToggleSwitch { Content = "ブロードキャストモード", IsChecked = _ctx.State.Broadcast };
        broadcast.IsCheckedChanged += (_, _) => SendRoom(new { t = "broadcast", on = broadcast.IsChecked == true }); box.Children.Add(broadcast);
        box.Children.Add(Ui.Text("距離に関係なく全員に声が届きます", 12, Ui.Muted));
        box.Children.Add(Ui.Text("ワールド（全員に反映）", 13));
        foreach (var (kind, name) in new[] { ("room", "ホール"), ("cafe", "カフェ"), ("game", "ゲーム") }) box.Children.Add(Ui.Button(name + (kind == _ctx.State.World ? "  ✓" : ""), () => ConfirmWorld(kind, name)));
        box.Children.Add(Ui.Button("プロフィールを編集", () => _ctx.OpenProfile(_ctx.State.SelfId)));
        if (_ctx.Media is Tonarium.Desktop.Media.NativeMedia nativeMedia)
            box.Children.Add(Ui.Button("マイク・スピーカーの設定", () => Run(nativeMedia.ShowAudioSettingsAsync)));
        box.Children.Add(Ui.Button("セッションを移動", () => _ctx.ShowHome("home")));
        box.Children.Add(Ui.Button(_ctx.State.Mode == "3d" ? "2D に切り替える" : "3D に切り替える", () => Run(() => _ctx.ChangeModeAsync(_ctx.State.Mode == "3d" ? "2d" : "3d")))); ShowPopup(box, 370);
    }
    private void ConfirmWorld(string kind, string name)
    {
        var clear = new CheckBox { Content = "置いてあるアイテムをすべて片付ける" }; var win = new Window();
        var box = Ui.Column(Ui.Title($"「{name}」に切り替えますか？", "3秒後に全員のワールドが切り替わります。"), clear, Ui.Button("切り替える", () => { SendRoom(new { t = "world", world = kind, clearItems = clear.IsChecked == true }); win.Close(); }));
        ConfigurePopup(win, box, 420); win.Show(_ctx.Owner);
    }
    private void Conversations()
    {
        var box = Ui.Column(Ui.Title("メッセージ", "セッションに参加したまま返信できます"));
        foreach (var (key, value) in _ctx.State.Conversations)
        {
            var title = key.StartsWith("dm:") ? key[3..].Split('\0').FirstOrDefault(x => x != _ctx.State.Name) ?? key : key;
            box.Children.Add(Ui.Button(title, () => { _conversation = key; _chatSignature = ""; _scope.IsVisible = false; _input.PlaceholderText = title + "にメッセージ"; Refresh(); var messages = J.Array(_ctx.State.Conversations, key); if (messages.LastOrDefault() is { } last) Run(() => _ctx.Client.SendAsync(new { t = "read", conv = key, at = J.Number(last, "at") })); }));
        }
        box.Children.Add(Ui.Button("セッションのログに戻る", () => { _conversation = null; _scope.IsVisible = true; _chatSignature = ""; Refresh(); }));
        if (_ctx.State.Conversations.Count == 0) box.Children.Add(Ui.Button("フレンド・メッセージを開く", () => _ctx.ShowHome("messages")));
        ShowPopup(box, 360);
    }
    private async Task AttachAsync(bool asItem = false)
    {
        var files = await _ctx.Owner.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions { Title = "画像・動画を共有", AllowMultiple = true, FileTypeFilter = new[] { new FilePickerFileType("画像・動画") { Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.mp4", "*.webm" } } } });
        foreach (var file in files.Take(5))
        {
            await using var input = await file.OpenReadAsync(); var video = file.Name.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) || file.Name.EndsWith(".webm", StringComparison.OrdinalIgnoreCase); var max = video ? 50_000_000 : 10_000_000;
            if (input.Length > max) { _ctx.Notify("画像は10MB、動画は50MBまで共有できます"); continue; }
            using var memory = new System.IO.MemoryStream(); await input.CopyToAsync(memory); var bytes = memory.ToArray(); var w = 16; var h = 9;
            if (!video) { using var bmp = new Bitmap(new System.IO.MemoryStream(bytes)); w = bmp.PixelSize.Width; h = bmp.PixelSize.Height; }
            using var content = new ByteArrayContent(bytes); content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(video ? file.Name.EndsWith(".webm") ? "video/webm" : "video/mp4" : file.Name.EndsWith(".png") ? "image/png" : file.Name.EndsWith(".gif") ? "image/gif" : file.Name.EndsWith(".webp") ? "image/webp" : "image/jpeg");
            using var response = await Http.PostAsync(new Uri(new Uri(_ctx.State.ServerUrl), "/media"), content); response.EnsureSuccessStatusCode(); var result = JsonNode.Parse(await response.Content.ReadAsStringAsync()); var url = J.Text(result, "url");
            if (asItem) await SpawnAsync(video ? "video" : "image", new { url, w, h });
            else if (_conversation is not null) await _ctx.Client.SendAsync(new { t = "msg", conv = _conversation, text = _input.Text ?? "", media = new { kind = video ? "video" : "image", url, w, h } });
            else await _ctx.Client.SendRoomAsync(new { t = "chat", text = _input.Text ?? "", scope = _scope.SelectedIndex == 1 ? "all" : _scope.SelectedIndex == 2 ? "announce" : "near", media = new { kind = video ? "video" : "image", url, w, h } });
            _input.Text = ""; _ctx.Notify("共有しました");
        }
    }
    private Control Face(JsonNode user, double size)
    {
        var name = J.Text(user, "name", "?"); var face = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size / 2), ClipToBounds = true, Background = Brush.Parse(UserColor(J.Text(user, "id"))), Child = CenterText(name[..1], size * .42) };
        var version = J.Text(user, "icon"); if (version == "") return face;
        var url = new Uri(new Uri(_ctx.State.ServerUrl), "/icon?name=" + Uri.EscapeDataString(name) + "&v=" + Uri.EscapeDataString(version)).ToString();
        if (IconCache.TryGetValue(url, out var cached)) face.Child = new Image { Source = cached, Stretch = Stretch.UniformToFill };
        else Run(async () => { var bitmap = new Bitmap(new System.IO.MemoryStream(await Http.GetByteArrayAsync(url))); IconCache[url] = bitmap; face.Child = new Image { Source = bitmap, Stretch = Stretch.UniformToFill }; });
        return face;
    }
    private void OpenPortrait(JsonNode user)
    {
        var id = J.Text(user, "id"); var portrait = new RoomPortrait(UserColor(id)) { Height = 320, Width = 380 }; LoadPortrait(portrait, user);
        var content = Ui.Column(Ui.Title(J.Text(user, "name")), portrait, Ui.Button("プロフィール", () => _ctx.OpenProfile(id)));
        if (J.Bool(user, "sharing")) content.Children.Add(Ui.Button("▣ ライブを見る", () => OpenLive(id)));
        ShowPopup(content, 430);
    }
    private void OpenLive(string id)
    {
        var name = J.Text(_ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == id), "name", "画面共有");
        var window = new Window { Title = name + " · ライブ", Width = 880, Height = 540, MinWidth = 400, MinHeight = 260, Content = _ctx.Media.CreateVideoView(id), WindowStartupLocation = WindowStartupLocation.CenterOwner };
        window.Show(_ctx.Owner);
    }
    private void ConfirmLink(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
        var window = new Window(); var box = Ui.Column(Ui.Title("リンクを開きますか？"), Ui.Text(url, 12), Ui.Button("ブラウザーで開く", () => { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); window.Close(); }));
        var youtube = Regex.Match(url, @"(?:youtube\.com/(?:watch\?(?:[^#\s]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})");
        if (youtube.Success) box.Children.Add(Ui.Button("YouTube を目の前に出す", () => { Run(() => SpawnAsync("youtube", new { videoId = youtube.Groups[1].Value, title = "YouTube" })); window.Close(); }));
        ConfigurePopup(window, box, 470); window.Show(_ctx.Owner);
    }
    private void SetWindowMode(bool free) { RoomWindowLayout.Free = free; NativeSettings.SetBool("room.freeWindows", free); _ctx.Notify(free ? "フリー：ウィンドウを自由に動かせます" : "カンタン：アイテムを中央に表示します"); }
    private void WindowOptions() => ShowPopup(Ui.Column(Ui.Title("ウィンドウの表示"), Ui.Button("カンタン — 開いたものを中央に表示", () => SetWindowMode(false)), Ui.Button("フリー — 自由に動かす", () => SetWindowMode(true))), 380);
    private void ToggleLeft() { _leftHidden = !_leftHidden; NativeSettings.SetBool("room.leftFolded", _leftHidden); _left.IsVisible = !_leftHidden; _leftFold.IsVisible = _leftHidden; Fit(); }
    private void ToggleRight() { _rightHidden = !_rightHidden; NativeSettings.SetBool("room.rightFolded", _rightHidden); _right.IsVisible = !_rightHidden; _rightFold.IsVisible = _rightHidden; Fit(); }
    private void Fit() { var compact = Bounds.Width < 1080; _left.Width = compact ? 260 : 308; _right.Width = compact ? 275 : 304; _center.Margin = new Thickness(_leftHidden ? 90 : _left.Width + 38, 95, _rightHidden ? 90 : _right.Width + 38, 140); }
    private static string UserColor(string id) { var n = id.Aggregate(0, (a, c) => unchecked(a * 31 + c)); return new[] { "#DDD1EC", "#F0D4BD", "#CDE4DF", "#D3E0EE", "#E9D0D4" }[(int)((uint)n % 5)]; }
    private static string Time(double at) => at > 0 ? DateTimeOffset.FromUnixTimeMilliseconds((long)at).ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture) : "";
    private static Control Empty(string text) => new Border { Padding = new Thickness(6, 16), Child = Ui.Text(text, 12, Ui.Muted) };
    private static TextBlock CenterText(string text, double size) { var t = Ui.Text(text, size); t.HorizontalAlignment = HorizontalAlignment.Center; t.VerticalAlignment = VerticalAlignment.Center; return t; }
    private static Button Small(string label, Action action) { var b = Ui.Button(label, action); b.Padding = new Thickness(8, 6); b.FontSize = 12; b.Background = Brushes.Transparent; b.BorderThickness = new Thickness(0); return b; }
    private static Border Panel(Control child) => new() { Child = child, Padding = new Thickness(13), Background = Brush.Parse("#EEFFFDF9"), CornerRadius = new CornerRadius(20), BorderBrush = Brush.Parse("#FFFFFF"), BorderThickness = new Thickness(1), BoxShadow = new BoxShadows(new BoxShadow { Blur = 22, OffsetY = 5, Color = Color.Parse("#103C280A") }) };
    private void ShowPopup(Control body, double width) { var window = new Window(); ConfigurePopup(window, body, width); window.Show(_ctx.Owner); }
    private void ConfigurePopup(Window window, Control body, double width) { window.Title = "Tonarium"; window.Width = width; window.SizeToContent = SizeToContent.Height; window.MaxHeight = 720; window.MinHeight = 160; window.WindowStartupLocation = WindowStartupLocation.CenterOwner; window.Background = Brush.Parse(Ui.Paper); window.Content = new ScrollViewer { Content = new Border { Padding = new Thickness(22), Child = body }, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled }; }
    private void SendRoom(object message) => Run(() => _ctx.Client.SendRoomAsync(message));
    private async void Run(Func<Task> action) { try { await action(); } catch (Exception e) { _ctx.Notify(e.Message); } }

    private async void LoadPortrait(RoomPortrait portrait, JsonNode user)
    {
        try
        {
            var version = J.Text(user, "avatar");
            var key = version == "" ? "default-avatar" : _ctx.State.ServerUrl + "/avatar?name=" + Uri.EscapeDataString(J.Text(user, "name")) + "&v=" + Uri.EscapeDataString(version);
            if (!IconCache.TryGetValue(key, out var bitmap))
            {
                if (version == "")
                {
                    var uri = new Uri("avares://Tonarium/Assets/oekaki/sample.png");
                    if (AssetLoader.Exists(uri)) { using var stream = AssetLoader.Open(uri); bitmap = new Bitmap(stream); }
                    else bitmap = new Bitmap(new System.IO.MemoryStream(await Http.GetByteArrayAsync(new Uri(new Uri(_ctx.State.ServerUrl), "/oekaki/sample.png"))));
                }
                else bitmap = new Bitmap(new System.IO.MemoryStream(await Http.GetByteArrayAsync(key)));
                IconCache[key] = bitmap;
            }
            portrait.Texture = bitmap; portrait.InvalidateVisual();
        }
        catch { /* A profile without an uploaded avatar keeps its native fallback portrait. */ }
    }
}

/// <summary>Shared by the native item window manager, without affecting networking.</summary>
public static class RoomWindowLayout { public static bool Free { get; set; } }

internal sealed class RoomBackdrop : Control
{
    public override void Render(DrawingContext context)
    {
        base.Render(context); var dot = Brush.Parse("#D6CFC1");
        for (double y = 12; y < Bounds.Height; y += 22) for (double x = 12; x < Bounds.Width; x += 22) context.DrawEllipse(dot, null, new Point(x, y), .8, .8);
    }
}

/// <summary>Lightweight native default avatar portrait; no engine or render loop is needed in 2D.</summary>
internal sealed class RoomPortrait(string tint) : Control
{
    public Bitmap? Texture { get; set; }
    public override void Render(DrawingContext context)
    {
        base.Render(context); var w = Bounds.Width; var h = Bounds.Height; var ink = Brush.Parse("#3C3348"); var white = Brush.Parse("#FFFDF9");
        context.DrawRectangle(Brush.Parse(tint), null, new Rect(0, 0, w, h));
        if (Texture is { } texture)
        {
            var sourceW = texture.Size.Width / 6; var sourceH = texture.Size.Height / 3;
            // Normal front head and body occupy column two of the Oekaki atlas.
            context.DrawImage(texture, new Rect(sourceW * 1.22, sourceH * 1.20, sourceW * .57, sourceH * .72), new Rect(w * .28, h * .66, w * .44, h * .67));
            context.DrawImage(texture, new Rect(sourceW * 1.14, sourceH * .15, sourceW * .78, sourceH * .80), new Rect(w * .19, h * .07, w * .62, h * .81));
            return;
        }
        context.DrawEllipse(Brush.Parse("#AAFFFFFF"), null, new Point(w * .53, h * 1.04), w * .33, h * .42);
        context.DrawEllipse(white, null, new Point(w * .5, h * .47), w * .22, h * .30);
        context.DrawEllipse(ink, null, new Point(w * .435, h * .46), 2.4, 3.5);
        context.DrawEllipse(ink, null, new Point(w * .565, h * .46), 2.4, 3.5);
        context.DrawLine(new Pen(ink, 1.6), new Point(w * .47, h * .57), new Point(w * .53, h * .57));
        context.DrawEllipse(Brush.Parse("#E9B8B5"), null, new Point(w * .38, h * .54), 5, 2.5);
        context.DrawEllipse(Brush.Parse("#E9B8B5"), null, new Point(w * .62, h * .54), 5, 2.5);
    }
}
