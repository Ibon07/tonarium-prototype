using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Controls.Presenters;
using Avalonia.VisualTree;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Platform;
using Avalonia.Threading;
using Avalonia.Automation;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Tonarium.Desktop.Core;
using Tonarium.Desktop.Media;

namespace Tonarium.Desktop.Views;

/// <summary>The persistent native room shell. Input and scroll controls survive realtime updates.</summary>
public sealed partial class RoomView : UserControl
{
    private readonly NativeContext _ctx;
    private readonly Grid _root = new();
    private readonly SessionMenuView _sessionMenu;
    private readonly RoomBackdrop _backdrop = new() { IsHitTestVisible = false };
    private readonly List<Control> _hud = [];
    private bool _externalScene, _worldInputLocked, _sidePanelsStowed;
    public bool SidePanelsStowed => _sidePanelsStowed;
    private string _layoutMode = "";
    private readonly StackPanel _players = new() { Spacing = 5 };
    private readonly StackPanel _items = new() { Spacing = 5 };
    private readonly StackPanel _faces = new() { Spacing = 14, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _logs = new() { Spacing = 12 };
    private readonly Grid _logCanvas = new();
    private readonly StackPanel _notices = new() { Spacing = 7 };
    private readonly StackPanel _status = new() { Spacing = 5, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly ScrollViewer _logScroll;
    private bool _chatFollowTail = true, _chatLayoutPending, _chatScrollQueued;
    private readonly ScrollViewer _itemScroll;
    private readonly TextBlock _worldName = Ui.Text("", 15);
    private readonly Border _broadcastPill = new() { IsVisible = false };
    private readonly TextBlock _playerCount = Ui.Text("", 12, Ui.Muted);
    private readonly TextBlock _itemCount = Ui.Text("", 12, Ui.Muted);
    private readonly TextBox _input = Ui.Input("声の届く範囲（〜15m）に送信");
    private readonly Border _scope = new();
    private readonly Button[] _scopeButtons = new Button[3];
    private int _scopeIndex;
    private readonly Button _mic;
    private readonly Button _share;
    private readonly Button _mode;
    private readonly Button _simpleMode;
    private readonly Button _freeMode;
    private readonly Button _faceFold;
    private readonly Border _left;
    private readonly Border _right;
    private readonly Button _leftFold;
    private readonly Button _rightFold;
    private readonly Border _center;
    private int _openItemCount, _portraitWindowCount;
    private bool Gallery => _openItemCount + _portraitWindowCount == 0 && _ctx.State.Mode == "2d";
    private readonly Border _threeDSurface = new() { Margin = new Thickness(345, 90, 340, 100), IsVisible = false };
    private string _playersSignature = "", _itemsSignature = "", _chatSignature = "", _noticeSignature = "", _statusSignature = "";
    private bool _leftHidden, _rightHidden, _facesHidden, _chatOnly;
    private string? _conversation;
    private readonly Dictionary<string, TextBlock> _distanceLabels = new();
    private readonly Dictionary<string, (double X, double Z, double Yaw)> _places = new();
    private readonly DispatcherTimer _worldCountdown = new() { Interval = TimeSpan.FromMilliseconds(250) };
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
        _root.ClipToBounds = true;
        _leftHidden = NativeSettings.GetBool("room.leftFolded");
        _rightHidden = NativeSettings.GetBool("room.rightFolded");
        _facesHidden = NativeSettings.GetBool("room.facesFolded");
        Background = Brush.Parse("#EAE5DB");
        _root.Children.Add(_backdrop);
        _root.Children.Add(_threeDSurface);
        Content = _root;

        _sessionMenu = new SessionMenuView(context) { Margin = new Thickness(20, 20, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
        _root.Children.Add(_sessionMenu);
        _worldName.FontFamily = Ui.HeadingFont; _worldName.FontWeight = FontWeight.Bold; _worldName.MaxWidth = 155; _worldName.TextTrimming = TextTrimming.CharacterEllipsis; _worldName.TextWrapping = TextWrapping.NoWrap;
        _broadcastPill.Child = IconLabel("megaphone", "ブロードキャスト", 12, 10, "#7A4A22"); _broadcastPill.Background = Brush.Parse("#FBE8D7"); _broadcastPill.CornerRadius = new CornerRadius(99); _broadcastPill.Padding = new Thickness(7, 3);
        var head = Ui.Row(Ui.AssetImage("brand/mark.png", 32, 32), _worldName, _broadcastPill, Separator(false), IconButton("settings", "設定", Settings, 18)); head.Spacing = 10;
        var headCard = Panel(head); headCard.Padding = new Thickness(7); headCard.CornerRadius = new CornerRadius(16); headCard.Margin = new Thickness(76, 20, 0, 0); headCard.HorizontalAlignment = HorizontalAlignment.Left; headCard.VerticalAlignment = VerticalAlignment.Top;
        _root.Children.Add(headCard);

        var leftContent = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto,Auto,Auto") };
        var ph = PanelHeader("プレイヤー", _playerCount, IconButton("left", "プレイヤーとアイテムをたたむ", ToggleLeft, 15));
        leftContent.Children.Add(ph);
        var playerScroll = new ScrollViewer { Content = _players, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Padding = new Thickness(8, 2, 8, 12) };
        Grid.SetRow(playerScroll, 1); leftContent.Children.Add(playerScroll);
        var leftSplit = PanelSplit(); Grid.SetRow(leftSplit, 2); leftContent.Children.Add(leftSplit);
        var spawn = Small("出す", ItemPicker); spawn.Content = IconLabel("plus", "出す", 14, 12, "#FFFFFF"); spawn.Background = Brush.Parse(Ui.Ink); spawn.Foreground = Brushes.White; spawn.Height = 30; spawn.Padding = new Thickness(10, 0); spawn.CornerRadius = new CornerRadius(9);
        var ih = PanelHeader("アイテム", _itemCount, spawn); Grid.SetRow(ih, 3); leftContent.Children.Add(ih);
        _itemScroll = new ScrollViewer { Content = _items, MaxHeight = 280, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Padding = new Thickness(8, 0, 8, 12) };
        Grid.SetRow(_itemScroll, 4); leftContent.Children.Add(_itemScroll);
        _left = Panel(leftContent); _left.Padding = new Thickness(0); _left.Width = 320; _left.Margin = new Thickness(20, 74, 0, 20); _left.HorizontalAlignment = HorizontalAlignment.Left;
        _root.Children.Add(_left);
        _leftFold = FoldedPanel(true, ToggleLeft); _leftFold.Margin = new Thickness(20, 74, 0, 0); _leftFold.HorizontalAlignment = HorizontalAlignment.Left; _leftFold.VerticalAlignment = VerticalAlignment.Top; _leftFold.IsVisible = _leftHidden; _left.IsVisible = !_leftHidden;
        _root.Children.Add(_leftFold);

        var rightContent = new Grid { RowDefinitions = new RowDefinitions("Auto,Auto,Auto,Auto,Auto,*,Auto,Auto") };
        var tabs = Ui.Row(Small("通知・ログ", () => { _conversation = null; _scope.IsVisible = true; _chatSignature = ""; Refresh(); }), Small("メッセージ", Conversations), IconButton("right", "通知とログをたたむ", ToggleRight, 15));
        tabs.Spacing = 2; tabs.Margin = new Thickness(10, 6, 8, 0);
        rightContent.Children.Add(tabs);
        var noticeHead = PanelHeader("通知", null, Small("すべて既読", MarkNoticesRead)); Grid.SetRow(noticeHead, 1); rightContent.Children.Add(noticeHead);
        var noticeScroll = new ScrollViewer { Content = _notices, MaxHeight = 165, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, Padding = new Thickness(10, 2, 10, 10) };
        Grid.SetRow(noticeScroll, 2); rightContent.Children.Add(noticeScroll);
        var rightSplit = PanelSplit(); Grid.SetRow(rightSplit, 3); rightContent.Children.Add(rightSplit);
        var logTabs = Ui.Row(Small("すべて", () => { _chatOnly = false; _chatSignature = ""; Refresh(); }), Small("チャット", () => { _chatOnly = true; _chatSignature = ""; Refresh(); })); logTabs.Spacing = 2;
        var logHead = PanelHeader("ログ", null, logTabs); Grid.SetRow(logHead, 4); rightContent.Children.Add(logHead);
        _logs.Spacing = 4; _logs.VerticalAlignment = VerticalAlignment.Bottom; _logCanvas.Children.Add(_logs);
        // ScrollViewer自身のPaddingはスクロール可能範囲から外れるため、内容側に余白を持たせる。
        _logCanvas.Margin = new Thickness(12, 4);
        _logScroll = new ScrollViewer { Content = _logCanvas, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
        _logScroll.SizeChanged += (_, _) => _logCanvas.MinHeight = Math.Max(0, _logScroll.Bounds.Height - 8);
        _logScroll.ScrollChanged += (_, e) =>
        {
            if (_chatLayoutPending) return;
            if (e.ExtentDelta.Y != 0 || e.ViewportDelta.Y != 0)
            {
                if (_chatFollowTail) FollowChatTail();
            }
            else if (e.OffsetDelta.Y != 0) _chatFollowTail = IsChatAtBottom();
        };
        Grid.SetRow(_logScroll, 5); rightContent.Children.Add(_logScroll);
        var scopeGrid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*,1.2*") };
        for (var i = 0; i < 3; i++) { var index = i; var text = new[] { "声の範囲", "全体", "アナウンス" }[i]; var button = Small(text, () => SelectScope(index)); button.Content = i == 2 ? IconLabel("megaphone", text, 13) : Ui.Row(Dot(i == 0 ? "#D9A02B" : "#5B47A8", 8), Ui.Text(text, 12)); button.Height = 32; button.Padding = new Thickness(6, 0); button.HorizontalContentAlignment = HorizontalAlignment.Center; _scopeButtons[i] = button; Grid.SetColumn(button, i); scopeGrid.Children.Add(button); }
        _scope.Child = scopeGrid; _scope.Margin = new Thickness(10, 6, 10, 0); _scope.Padding = new Thickness(3); _scope.CornerRadius = new CornerRadius(11); _scope.Background = Brush.Parse("#1226262E"); Grid.SetRow(_scope, 6); rightContent.Children.Add(_scope); SelectScope(0);
        var compose = new Grid { ColumnDefinitions = new ColumnDefinitions("38,*,38"), Margin = new Thickness(10, 8, 10, 10), ColumnSpacing = 6 };
        var attach = IconButton("attach", "画像・動画を添付", () => Run(() => AttachAsync()), 18); attach.Background = Brushes.White; attach.BorderBrush = Brush.Parse("#DCD5C8"); attach.BorderThickness = new Thickness(1); compose.Children.Add(attach);
        attach.Width = attach.Height = 38;
        _input.MinWidth = 0; _input.AcceptsReturn = true; _input.MaxHeight = 100; _input.VerticalContentAlignment = VerticalAlignment.Center;
        _input.TextWrapping = TextWrapping.Wrap;
        ScrollViewer.SetHorizontalScrollBarVisibility(_input, ScrollBarVisibility.Disabled);
        ScrollViewer.SetVerticalScrollBarVisibility(_input, ScrollBarVisibility.Hidden);
        Grid.SetColumn(_input, 1); compose.Children.Add(_input);
        var send = IconButton("send", "送信", () => Run(SendChatAsync), 18); send.Background = Brush.Parse("#2F5FC4"); send.Foreground = Brushes.White; Grid.SetColumn(send, 2); compose.Children.Add(send);
        send.Content = new WebIcon("send", 18, Brushes.White); send.Width = send.Height = 38;
        // Handle Enter before TextBox's multiline handler; leave candidate confirmation to the native IME.
        _input.AddHandler(InputElement.KeyDownEvent, (_, e) =>
        {
            if (e.Key != Key.Enter || e.KeyModifiers.HasFlag(KeyModifiers.Shift)) return;
            if (_input.GetVisualDescendants().OfType<TextPresenter>().Any(p => !string.IsNullOrEmpty(p.PreeditText))) return;
            e.Handled = true;
            Run(SendChatAsync);
        }, RoutingStrategies.Tunnel);
        Grid.SetRow(compose, 7); rightContent.Children.Add(compose);
        _right = Panel(rightContent); _right.Padding = new Thickness(0); _right.Width = 300; _right.Margin = new Thickness(0, 20, 20, 20); _right.HorizontalAlignment = HorizontalAlignment.Right;
        _root.Children.Add(_right);
        _rightFold = FoldedPanel(false, ToggleRight); _rightFold.Margin = new Thickness(0, 20, 20, 0); _rightFold.HorizontalAlignment = HorizontalAlignment.Right; _rightFold.VerticalAlignment = VerticalAlignment.Top; _rightFold.IsVisible = _rightHidden; _right.IsVisible = !_rightHidden;
        _root.Children.Add(_rightFold);
        foreach (var panel in new[] { _left, _right })
            panel.Transitions = new Transitions { new ThicknessTransition { Property = MarginProperty, Duration = TimeSpan.FromMilliseconds(200), Easing = new CubicEaseOut() } };

        var centerStack = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        centerStack.Children.Add(_faces);
        _faceFold = IconButton("up", "顔の表示を上にたたむ", () => { _facesHidden = !_facesHidden; NativeSettings.SetBool("room.facesFolded", _facesHidden); _playersSignature = ""; Refresh(); }, 14);
        _faceFold.Width = 48; _faceFold.Height = 18; _faceFold.Padding = new Thickness(0); _faceFold.Background = Brush.Parse("#EEFFFDF9"); _faceFold.CornerRadius = new CornerRadius(0, 0, 10, 10); _faceFold.HorizontalAlignment = HorizontalAlignment.Center; centerStack.Children.Add(_faceFold);
        _mode = Ui.Button("3D 空間に入る  ↗", () => Run(() => _ctx.ChangeModeAsync(_ctx.State.Mode == "3d" ? "2d" : "3d")));
        _mode.HorizontalAlignment = HorizontalAlignment.Center; _mode.Padding = new Thickness(22, 12);
        _mode.Background = Brush.Parse("#2F5FC4"); _mode.Foreground = Brushes.White;
        _center = new Border { Child = centerStack, Margin = new Thickness(360, 90, 340, 144) };
        _root.Children.Add(_center);

        _mic = DockButton("micOff", "マイクのミュートを解除", () => Run(() => _ctx.Media.SetMicrophoneAsync(!_ctx.State.MicOn)));
        _share = DockButton("screen", "画面共有", () => Run(() => _ctx.Media.SetScreenShareAsync(!_ctx.State.Sharing)));
        _simpleMode = Small("カンタン", () => SetWindowMode(false)); _simpleMode.Content = IconLabel("window", "カンタン", 15);
        _freeMode = Small("フリー", () => SetWindowMode(true)); _freeMode.Content = IconLabel("layers", "フリー", 15);
        foreach (var button in new[] { _simpleMode, _freeMode }) { button.Height = 22; button.Padding = new Thickness(9, 0); button.FontSize = 11; button.CornerRadius = new CornerRadius(10); }
        var windowModes = Ui.Column(_simpleMode, _freeMode); windowModes.Spacing = 2;
        var modeSegment = new Border { Child = windowModes, Padding = new Thickness(3), Background = Brush.Parse("#3A3B44"), CornerRadius = new CornerRadius(14) };
        var leave = DockButton("leave", "切断", () => Run(() => _ctx.Client.LeaveAsync())); leave.Background = Brush.Parse("#C2402F");
        var dock = Ui.Row(_mic, _share, DockButton("music", "サウンドボード", Soundboard), Separator(true), modeSegment, Separator(true), leave); dock.Spacing = 8;
        var bottom = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(80, 0, 80, 22) };
        var dockPanel = Panel(dock); dockPanel.CornerRadius = new CornerRadius(24); dockPanel.Background = Brush.Parse("#26262E"); dockPanel.BorderThickness = new Thickness(0); dockPanel.Padding = new Thickness(10);
        bottom.Children.Add(_status); bottom.Children.Add(dockPanel); _root.Children.Add(bottom);
        _hud.AddRange([_sessionMenu,headCard,_left,_leftFold,_right,_rightFold,_center,bottom]);
        SizeChanged += (_, _) => Fit();
        _worldCountdown.Tick += (_, _) => Refresh();
        DetachedFromVisualTree += (_, _) => _worldCountdown.Stop();
        Refresh();
    }

    public void SetThreeDSurface(Control? surface)
    {
        _threeDSurface.Child = surface;
        _threeDSurface.IsVisible = surface is not null;
        _center.IsVisible = surface is null;
        Fit();
    }

    public void SetExternalScene(bool enabled)
    {
        _externalScene = enabled;
        if (!enabled) _sidePanelsStowed = false;
        Background = enabled ? Brushes.Transparent : Brush.Parse("#EAE5DB");
        _backdrop.IsVisible = !enabled;
        _center.IsVisible = true;
        _threeDSurface.IsVisible = false;
        SetWorldInputLocked(false);
        Fit();
    }

    public void ToggleSidePanels()
    {
        if (!_externalScene) return;
        _sidePanelsStowed = !_sidePanelsStowed;
        Fit();
    }

    public void SetWorldInputLocked(bool locked)
    {
        _worldInputLocked = locked;
        foreach(var panel in _hud) { panel.Opacity=locked?.4:1; panel.IsHitTestVisible=!locked; }
        if(_hud.Count>0)_hud[^1].Opacity=1;
        _status.Opacity=locked?.8:1;
        if(_hud.LastOrDefault() is StackPanel bottom&&bottom.Children.Count>1)bottom.Children[1].Opacity=locked?.4:1;
    }

    public void FocusChat() => _input.Focus();

    public IReadOnlyList<Rect> OverlayRegions(Visual relativeTo)
    {
        var regions = new List<Rect>();
        foreach(var panel in _hud.Where(p=>p.IsEffectivelyVisible))
            if(panel.TranslatePoint(default,relativeTo) is { } position && panel.Bounds.Width>0 && panel.Bounds.Height>0)
                regions.Add(new Rect(position,panel.Bounds.Size));
        return regions;
    }

    public void SetOpenItemCount(int count)
    {
        if (_openItemCount == count) return;
        _openItemCount = Math.Max(0, count);
        Fit();
    }

    public void Refresh()
    {
        var s = _ctx.State;
        if(_layoutMode!=s.Mode){_layoutMode=s.Mode;Fit();}
        _sessionMenu.Refresh();
        ComputePlaces();
        var users = Participants();
        _worldName.Text = J.Text(s.Sessions.FirstOrDefault(x => J.Text(x, "id") == s.SessionId), "name", "セッション"); _broadcastPill.IsVisible = s.Broadcast;
        _playerCount.Text = users.Count.ToString(); _itemCount.Text = s.Items.Count.ToString();
        var micName = s.MicOn ? "マイクをミュート" : "マイクのミュートを解除";
        if (!Equals(_mic.Tag, micName)) { _mic.Tag = micName; _mic.Content = new WebIcon(s.MicOn ? "mic" : "micOff", 22, Brushes.White); AutomationProperties.SetName(_mic, micName); ToolTip.SetTip(_mic, s.MicOn ? "ミュート" : "ミュート解除"); }
        _mic.Background = Brush.Parse(s.MicOn ? "#3A3B44" : "#F06A5A");
        _share.Background = Brush.Parse(s.Sharing ? "#2E9A64" : "#3A3B44");
        AutomationProperties.SetName(_share, s.Sharing ? "画面共有を停止" : "画面共有");
        StyleWindowModes();
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
        if (s.WorldPending is not null && !_worldCountdown.IsEnabled) _worldCountdown.Start();
        else if (s.WorldPending is null && _worldCountdown.IsEnabled) _worldCountdown.Stop();
        var st = $"{s.ConnectionStatus}|{s.SyncStatus}|{J.Text(me, "follow")}|{J.Object(me, "pos").ToJsonString()}|{s.Mode}|{(s.WorldPending is null ? "" : DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString())}";
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
    private static Control BandLabel(int band)
    {
        var row = Ui.Row(Dot(band == 0 ? "#2E9A64" : band == 1 ? "#D9A02B" : "#9A98A2", 8), Ui.Text(band == 0 ? "すぐそば" : band == 1 ? "声が届く" : "とおく", 12, Ui.Muted), Ui.Text(band == 0 ? "〜3m" : band == 1 ? "〜15m" : "15m〜", 12, Ui.Muted));
        row.Spacing = 8; row.Margin = new Thickness(8, 4); return row;
    }

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
        var large = self || Distance(user) <= 3;
        if (!self && Distance(user) > 15)
        {
            var far = Small(name, () => PickUser(id)); far.Content = Ui.Row(Face(user, 20), Ui.Text(name, 12)); far.Padding = new Thickness(3, 2, 8, 2); far.Height = 26; far.HorizontalAlignment = HorizontalAlignment.Left; far.Background = Brush.Parse("#0D26262E"); far.CornerRadius = new CornerRadius(99); return far;
        }
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions(large ? "32,*,Auto,Auto" : "22,*,Auto,Auto"), ColumnSpacing = 8 };
        var face = Face(user, large ? 32 : 22); row.Children.Add(face);
        var names = Ui.Row(Ui.Text(name, large ? 14 : 13)); names.Spacing = 4;
        if (!self && J.Text(user, "mode") == "3d") names.Children.Add(Pill("3D", "#26262E", "#FFFFFF"));
        var label = Ui.Column(names); label.Spacing = 0;
        var status = (!J.Bool(user, "micOn") ? "ミュート" : "") + (J.Text(user, "follow") != "" ? " · ついていく" : "");
        if (!self && status.Length > 0) label.Children.Add(Ui.Text(status.Trim(' ', '·'), 11, Ui.Muted));
        var nameButton = Ui.Button("", () => PickUser(id)); nameButton.Content = label; nameButton.Padding = new Thickness(4); nameButton.Background = Brushes.Transparent; nameButton.BorderThickness = new Thickness(0); nameButton.HorizontalContentAlignment = HorizontalAlignment.Left; Grid.SetColumn(nameButton, 1); row.Children.Add(nameButton);
        if (self) { var badges = Ui.Row(Pill("あなた", "#26262E", "#FFFFFF"), Pill(_ctx.State.Mode.ToUpperInvariant(), "#EBE6DD", Ui.Muted)); badges.Spacing = 4; Grid.SetColumn(badges, 2); Grid.SetColumnSpan(badges, 2); row.Children.Add(badges); }
        else if (J.Bool(user, "sharing")) { var live = Small("ライブ", () => OpenLive(id)); live.Content = IconLabel("screen", "ライブ", 11, 10, "#FFFFFF"); live.Background = Brush.Parse("#D9483B"); live.Foreground = Brushes.White; live.Height = 22; live.CornerRadius = new CornerRadius(99); Grid.SetColumn(live, 2); row.Children.Add(live); }
        else { var dist = Ui.Text(self ? "" : FormatDistance(Distance(user)), 10, Ui.Muted); dist.VerticalAlignment = VerticalAlignment.Center; if (!self) _distanceLabels[id] = dist; Grid.SetColumn(dist, 2); row.Children.Add(dist); }
        if (!self) { var more = IconButton("more", name + " のアクション", () => UserMenu(user), 16); more.Width = large ? 30 : 26; more.Height = large ? 30 : 26; Grid.SetColumn(more, 3); row.Children.Add(more); }
        var card = new Border { Child = row, Padding = new Thickness(8, large ? 5 : 1, 4, large ? 5 : 1), CornerRadius = new CornerRadius(12), Background = self ? Brush.Parse("#0D26262E") : Brushes.Transparent };
        if (J.Text(user, "follow") != "") card.Margin = new Thickness(14, 0, 0, 0);
        return card;
    }
    private void PickUser(string id)
    {
        var held = _ctx.State.Items.FirstOrDefault(p => J.Text(p.Value, "kind") == "hammer" && J.Text(p.Value, "holder") == _ctx.State.SelfId);
        if (held.Key is not null && id != _ctx.State.SelfId) Run(async () => { await _ctx.Client.SendRoomAsync(new { t = "hit", to = id }); if (_ctx.State.Mode == "2d") await GoNearAsync(id, .8); });
        else _ctx.OpenProfile(id);
    }
    private void UserMenu(JsonNode user)
    {
        var id = J.Text(user, "id"); var box = Ui.Column(Ui.Title(J.Text(user, "name")), ActionButton("user", "プロフィール", () => _ctx.OpenProfile(id)), ActionButton("near", "そばにいく", () => Run(() => GoNearAsync(id))), ActionButton("poke", "つんつん", () => SendRoom(new { t = "poke", to = id })));
        if (J.Text(user, "mode") == "3d" && id != _ctx.State.SelfId) box.Children.Add(ActionButton("follow", "ついていく / やめる", () => { var me = Participants().FirstOrDefault(x => J.Text(x, "id") == _ctx.State.SelfId); SendRoom(new { t = "follow", target = J.Text(me, "follow") == id ? null : id }); }));
        ShowPopup(box, 310);
    }
    private void RebuildFaces(List<JsonNode> users)
    {
        _faces.Children.Clear(); _faceFold.IsVisible = !Gallery && !_facesHidden;
        var self = users.FirstOrDefault(u => J.Text(u, "id") == _ctx.State.SelfId);
        var near = users.Where(u => J.Text(u, "id") != _ctx.State.SelfId && Distance(u) <= 3).OrderBy(Distance).ToList();
        var mid = users.Where(u => J.Text(u, "id") != _ctx.State.SelfId && Distance(u) > 3 && Distance(u) <= 15).OrderBy(Distance).ToList();
        if (_facesHidden)
        {
            var mini = Ui.Row(); mini.Spacing = 0;
            foreach (var u in near.Take(4)) mini.Children.Add(Face(u, 24));
            var expand = Small("", () => { _facesHidden = false; NativeSettings.SetBool("room.facesFolded", false); Fit(); });
            expand.Content = Ui.Row(mini, Ui.Text($"すぐそば {near.Count}", 12), Ui.Text($"· 声が届く {mid.Count}", 12, Ui.Muted), new WebIcon("down", 14));
            expand.Background = Brush.Parse("#F0FFFDF9"); expand.CornerRadius = new CornerRadius(99); expand.Padding = new Thickness(6, 4, 10, 4);
            _faces.Children.Add(expand); return;
        }
        if (Gallery)
        {
            var all = new List<JsonNode>(); if (self is not null) all.Add(self); all.AddRange(near); all.AddRange(mid);
            var availableWidth = Math.Max(120, Bounds.Width - _center.Margin.Left - _center.Margin.Right);
            var availableHeight = Math.Max(120, Bounds.Height - 234);
            var size = GalleryTile(all.Count, availableWidth, availableHeight);
            var wrap = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = availableWidth, Orientation = Orientation.Horizontal };
            foreach (var u in all) { var tile = FaceTile(u, size, false); tile.Margin = new Thickness(6); wrap.Children.Add(tile); }
            _faces.Children.Add(wrap); return;
        }
        var strip = Ui.Row(); strip.Spacing = 8;
        var available = Math.Max(150, Bounds.Width - _center.Margin.Left - _center.Margin.Right);
        var largeCount = Math.Min(4, near.Count) + (self is null ? 0 : 1);
        var largeWidth = Math.Clamp((available - (mid.Count > 0 ? 150 : 0) - Math.Max(0, largeCount - 1) * 8) / Math.Max(1, largeCount), 96, 144);
        if (self is not null) strip.Children.Add(FaceTile(self, largeWidth, false));
        foreach (var u in near.Take(4)) strip.Children.Add(FaceTile(u, largeWidth, false));
        if (mid.Count > 0)
        {
            var small = new WrapPanel { Orientation = Orientation.Vertical, Height = 108, MaxWidth = 148 };
            foreach (var u in mid.Take(3)) { var tile = FaceTile(u, 70, true); tile.Margin = new Thickness(2); small.Children.Add(tile); }
            if (mid.Count > 3) small.Children.Add(new Border { Width = 70, Height = 52, CornerRadius = new CornerRadius(10), Background = Brush.Parse("#BB26262E"), Child = CenterText($"+{mid.Count - 3}", 14) });
            strip.Children.Add(small);
        }
        _faces.Children.Add(strip);
    }
    private static double GalleryTile(int n, double width, double height)
    {
        var best = 96d;
        for (var columns = 1; columns <= Math.Max(1, n); columns++) { var rows = Math.Ceiling(n / (double)columns); var tile = Math.Min((width - (columns - 1) * 12) / columns, ((height - (rows - 1) * 12) / rows) * 4 / 3); best = Math.Max(best, tile); }
        return Math.Clamp(Math.Floor(best - 12), 96, 420);
    }
    private Control FaceTile(JsonNode user, double width, bool small)
    {
        var id = J.Text(user, "id"); var self = id == _ctx.State.SelfId; var color = PortraitColor(id); var height = width * .75;
        var portrait = new AvatarPortrait(_ctx, id, small) { Height = height, Width = width };
        var content = new Grid(); content.Children.Add(portrait);
        var button = Small("", () =>
        {
            if (_ctx.State.Mode == "2d" && id != _ctx.State.SelfId && _ctx.State.Items.Any(p => J.Text(p.Value, "kind") == "hammer" && J.Text(p.Value, "holder") == _ctx.State.SelfId)) PickUser(id);
            else OpenPortrait(user);
        }); button.Content = content; button.Padding = new Thickness(0); button.Width = width; button.Height = height; button.CornerRadius = new CornerRadius(small ? 10 : 14); button.ClipToBounds = true;
        var body = new Grid(); body.Children.Add(button);
        if (small)
        {
            var face = Face(user, 16); face.HorizontalAlignment = HorizontalAlignment.Left; face.VerticalAlignment = VerticalAlignment.Bottom; face.Margin = new Thickness(4); body.Children.Add(face);
        }
        else
        {
            var footer = new Grid { ColumnDefinitions = new ColumnDefinitions("18,Auto,*,Auto"), ColumnSpacing = 5 };
            footer.Children.Add(Face(user, 18));
            var status = new WebIcon(J.Bool(user, "micOn") ? "speaking" : "micOff", 12, Brush.Parse(J.Bool(user, "micOn") ? "#7FE0A8" : "#F6A79C")); Grid.SetColumn(status, 1); footer.Children.Add(status);
            var name = Ui.Text(J.Text(user, "name"), Gallery ? 13 : 12, "#FFFFFF"); name.TextWrapping = TextWrapping.NoWrap; name.TextTrimming = TextTrimming.CharacterEllipsis; name.FontWeight = FontWeight.Bold; Grid.SetColumn(name, 2); footer.Children.Add(name);
            var distance = Ui.Text(self ? "あなた" : FormatDistance(Distance(user)), 10, "#FFFFFF"); Grid.SetColumn(distance, 3); footer.Children.Add(distance);
            body.Children.Add(new Border { Child = footer, Background = Brush.Parse("#B826262E"), CornerRadius = new CornerRadius(9), Padding = new Thickness(3, 2, 7, 2), Height = Gallery ? 28 : 24, Margin = new Thickness(6), VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false });
            var profile = IconButton("more", J.Text(user, "name") + " のプロフィール", () => _ctx.OpenProfile(id), 14); profile.Background = Brush.Parse("#C7FFFFFF"); profile.Width = profile.Height = 28; profile.HorizontalAlignment = HorizontalAlignment.Right; profile.VerticalAlignment = VerticalAlignment.Top; profile.Margin = new Thickness(5); body.Children.Add(profile);
            var last = _ctx.State.Chats.LastOrDefault(m => J.Text(m, "from") == id && J.Text(m, "text") != "" && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - J.Number(m, "at") < 30000);
            if (last is not null) { var text = Ui.Text(J.Text(last, "text"), 11); text.TextWrapping = TextWrapping.NoWrap; text.TextTrimming = TextTrimming.CharacterEllipsis; body.Children.Add(new Border { Child = text, Background = Brush.Parse("#F2FFFFFF"), CornerRadius = new CornerRadius(9, 9, 9, 3), Padding = new Thickness(8, 4), Margin = new Thickness(6, 0, 6, 38), VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false }); }
        }
        if (J.Text(user, "mode") == "3d") { var badge = Pill("3D", "#26262E", "#FFFFFF"); badge.HorizontalAlignment = HorizontalAlignment.Left; badge.VerticalAlignment = VerticalAlignment.Top; badge.Margin = new Thickness(6); body.Children.Add(badge); }
        return new Border { Child = body, Width = width, Height = height, Background = Brush.Parse(color), ClipToBounds = true, CornerRadius = new CornerRadius(small ? 10 : 14), BorderThickness = new Thickness(J.Bool(user, "speaking") ? 3 : self ? 2 : 1), BorderBrush = Brush.Parse(J.Bool(user, "speaking") ? "#2E9A64" : self ? "#8C8886" : "#1826262E") };
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
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("32,*,Auto,Auto"), ColumnSpacing = 6, Margin = new Thickness(8, 5, 4, 5) }; row.Children.Add(mark);
            var name = kind == "note" ? J.Text(item, "text", "付箋（空）").Split('\n')[0] : kind == "youtube" ? J.Text(item, "title", info.Name) : info.Name;
            if (name.Length > 17) name = name[..17] + "…";
            var open = Small(name, () => _ctx.OpenItem("item:" + id)); open.Padding = new Thickness(0); open.HorizontalContentAlignment = HorizontalAlignment.Left; open.FontSize = 14; Grid.SetColumn(open, 1); row.Children.Add(open);
            if (kind != "hammer") { var ob = Small("開く", () => _ctx.OpenItem("item:" + id)); ob.Padding = new Thickness(8, 0); ob.Height = 22; ob.FontSize = 11; ob.FontWeight = FontWeight.Bold; ob.Background = Brushes.White; ob.BorderBrush = Brush.Parse("#DCD5C8"); ob.BorderThickness = new Thickness(1); ob.CornerRadius = new CornerRadius(99); Grid.SetColumn(ob, 2); row.Children.Add(ob); }
            var menu = IconButton("more", name + " のアクション", () => ItemMenu(id), 16); menu.Width = menu.Height = 30; Grid.SetColumn(menu, 3); row.Children.Add(menu); _items.Children.Add(row);
        }
        if (_items.Children.Count == 0) _items.Children.Add(Empty("「出す」からアイテムを置けます"));
    }
    private void ItemMenu(string id)
    {
        var it = _ctx.State.Items[id]; var holder = J.Text(it, "holder"); var kind = J.Text(it, "kind");
        var box = Ui.Column(Ui.Title(ItemInfo.GetValueOrDefault(kind, (Name: kind, Mark: "", Tint: "")).Name), ActionButton("window", "ウィンドウを開く", () => _ctx.OpenItem("item:" + id)), ActionButton("near", "そばにいく", () => Run(() => GoNearAsync("item:" + id))), ActionButton("sparkle", "注目を集める", () => SendRoom(new { t = "attention", key = "item:" + id })));
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
    private async Task GoNearAsync(string id, double gap = 1)
    {
        var me = _places.GetValueOrDefault(_ctx.State.SelfId); (double X, double Z, double Yaw) target;
        if (id.StartsWith("item:")) { var it = _ctx.State.Items[id[5..]]; var holder = J.Text(it, "holder"); target = holder != "" ? _places.GetValueOrDefault(holder) : (J.Number(it, "x"), J.Number(it, "z"), J.Number(it, "ry")); }
        else target = _places.GetValueOrDefault(id);
        var dx = me.X - target.X; var dz = me.Z - target.Z; var len = Math.Sqrt(dx * dx + dz * dz); if (len < .01) { dx = 0; dz = 1; } else { dx /= len; dz /= len; }
        var x = Math.Clamp(target.X + dx * gap, -9.5, 9.5); var z = Math.Clamp(target.Z + dz * gap, -9.5, 9.5); var ry = Math.Atan2(-(target.X - x), -(target.Z - z));
        if (_ctx.State.Mode == "3d") await _ctx.TeleportAsync(x, z, ry);
        else await _ctx.Client.SendRoomAsync(new { t = "place2d", target = _ctx.State.SelfId, pos = new { x, z, ry } });
    }
    private async Task SendChatAsync()
    {
        var text = _input.Text?.Trim() ?? ""; if (text.Length == 0) return;
        if (_conversation is not null) await _ctx.Client.SendAsync(new { t = "msg", conv = _conversation, text });
        else await _ctx.Client.SendRoomAsync(new { t = "chat", text, scope = _scopeIndex == 1 ? "all" : _scopeIndex == 2 ? "announce" : "near" });
        _input.Text = "";
    }
    private void RebuildChat(JsonArray chats)
    {
        var atBottom = _chatFollowTail || IsChatAtBottom();
        _chatLayoutPending = true;
        var oldOffset = _logScroll.Offset; _logs.Children.Clear();
        foreach (var m in chats.Where(m => (!_chatOnly || J.Text(m, "from") != "") && !NativeSettings.BlockedNames.Contains(J.Text(m, "fromName", J.Text(m, "from")))).TakeLast(150))
        {
            var from = J.Text(m, "fromName", J.Text(m, "from")); var text = J.Text(m, "text");
            if (from == "") { _logs.Children.Add(new Border { Child = Ui.Text(text, 12, Ui.Muted), Padding = new Thickness(8, 3) }); continue; }
            var userId = J.Text(m, "from"); var nameLabel = Ui.Text(from, 12, UserColor(userId)); nameLabel.FontWeight = FontWeight.Bold;
            var top = Ui.Row(nameLabel); top.Spacing = 6;
            var scope = J.Text(m, "scope"); if (scope is "all" or "announce") top.Children.Add(Pill(scope == "all" ? "全体" : "アナウンス", scope == "all" ? "#5B47A8" : "#26262E", "#FFFFFF"));
            top.Children.Add(Ui.Text(Time(J.Number(m, "at")), 10, Ui.Muted));
            var body = Ui.Column(top); body.Spacing = 2;
            if (text.Length > 0) body.Children.Add(new SelectableTextBlock { Text = text, FontFamily = Ui.BodyFont, FontSize = 13, TextWrapping = TextWrapping.Wrap, Foreground = Brush.Parse(scope == "all" ? "#3E2F80" : "#26262E") });
            var url = Regex.Match(text, @"https?://[^\s<>]+").Value;
            if (url.Length > 0) { var link = Small("リンクを開く", () => ConfirmLink(url)); link.Content = IconLabel("link", "リンクを開く", 12); body.Children.Add(link); }
            var dice = m?["dice"]; if (dice is not null) body.Children.Add(Ui.Text("🎲 " + J.Array(dice, "results").ToJsonString(), 14));
            var media = m?["media"];
            if (J.Text(m, "image") is { Length: > 0 } inlineImage) body.Children.Add(new ChatMediaPreview(_ctx, inlineImage));
            if (J.Text(media, "kind") == "image") body.Children.Add(new ChatMediaPreview(_ctx, J.Text(media, "url")));
            if (J.Text(media, "kind") == "video") { var mediaButton = Small("動画を開く", () => OpenMedia(m!)); mediaButton.Content = IconLabel("play", "動画を開く", 12); body.Children.Add(mediaButton); }
            if (media is not null || J.Text(m, "image") != "" || MediaAttachments.TryYouTubeId(text) is not null)
                body.Children.Add(Small("アイテムにする", () => Run(() => ItemizeMessageAsync(m!))));
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("22,*"), ColumnSpacing = 8 };
            var person = _ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == userId) ?? new JsonObject { ["id"] = userId, ["name"] = from };
            var face = Face(person, 22); face.VerticalAlignment = VerticalAlignment.Top; face.Margin = new Thickness(0, 1, 0, 0); row.Children.Add(face); Grid.SetColumn(body, 1); row.Children.Add(body);
            _logs.Children.Add(new Border { Child = row, Padding = new Thickness(8, 5), CornerRadius = new CornerRadius(10), Background = scope == "all" ? Brush.Parse("#EEEAF8") : scope == "announce" ? Brush.Parse("#1026262E") : Brushes.Transparent });
        }
        if (_logs.Children.Count == 0) _logs.Children.Add(Empty(_conversation is null ? "ここから会話をはじめよう" : "メッセージはまだありません"));
        Dispatcher.UIThread.Post(() =>
        {
            _chatFollowTail = atBottom;
            if (atBottom) _logScroll.ScrollToEnd(); else _logScroll.Offset = oldOffset;
            _chatLayoutPending = false;
        }, DispatcherPriority.Loaded);
    }
    private bool IsChatAtBottom() => _logScroll.Offset.Y >= _logScroll.Extent.Height - _logScroll.Viewport.Height - 2;
    private void FollowChatTail()
    {
        if (_chatScrollQueued) return;
        _chatScrollQueued = true;
        Dispatcher.UIThread.Post(() =>
        {
            _chatScrollQueued = false;
            if (_chatFollowTail && !_chatLayoutPending) _logScroll.ScrollToEnd();
        }, DispatcherPriority.Loaded);
    }
    private void OpenMedia(JsonNode message)
    {
        var media = message["media"]; var url = J.Text(media, "url", J.Text(message, "image"));
        if (url == "") return;
        if (J.Text(media, "kind") != "video") { ChatMediaPreview.ShowViewer(_ctx, url); return; }
        var box = Ui.Column(Ui.Title("共有されたメディア"), Ui.Button("目の前に出す", () => Run(() => ItemizeMessageAsync(message))));
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
        ShowPopup(box, 560);
    }
    private void RebuildNotices()
    {
        _notices.Children.Clear();
        var announce = _ctx.State.Chats.LastOrDefault(x => J.Text(x, "scope") == "announce");
        if (announce is not null) _notices.Children.Add(new Border { Background = Brush.Parse(Ui.Ink), CornerRadius = new CornerRadius(12), Padding = new Thickness(10), Child = Ui.Column(IconLabel("megaphone", "アナウンス", 16, 11, "#FFFFFF"), Ui.Text(J.Text(announce, "text"), 12, "#FFFFFF")) });
        foreach (var n in _ctx.State.Notifications.Where(n => !NativeSettings.BlockedNames.Contains(J.Text(n, "fromName", J.Text(_ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == J.Text(n, "from")), "name")))).TakeLast(30).Reverse())
        {
            var kind = NoticeKind(n); var from = J.Text(n, "from"); var name = J.Text(n, "fromName", J.Text(_ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == from), "name", from));
            var action = kind switch { "poke" => "つんつん返す", "friend" => "承認", "attention" => "開く", "live" => "ライブを始める", "invite" => "参加する", _ => "見る" };
            var line = new Grid { ColumnDefinitions = new ColumnDefinitions("28,*,Auto"), ColumnSpacing = 8 };
            var user = _ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == from) ?? new JsonObject { ["id"] = from, ["name"] = name };
            line.Children.Add(Face(user, 28));
            var body = Ui.Column(Ui.Text(name + " " + NoticeText(kind), 12), Ui.Text(Time(J.Number(n, "at")), 11, Ui.Muted)); body.Spacing = 2; Grid.SetColumn(body, 1); line.Children.Add(body);
            var reply = Small(action, () => NoticeAction(n!)); reply.FontSize = 11; reply.Height = 28; reply.Padding = new Thickness(8, 0); reply.BorderThickness = new Thickness(1); reply.BorderBrush = Brush.Parse("#DCD5C8"); reply.Background = Brushes.White; Grid.SetColumn(reply, 2); line.Children.Add(reply);
            _notices.Children.Add(new Border { Child = line, Padding = new Thickness(8, 7), CornerRadius = new CornerRadius(12), Background = J.Bool(n, "unread") ? Brush.Parse("#F2FFFFFF") : Brushes.Transparent });
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
        var syncText = _ctx.State.SyncStatus switch { "connected" => "同期 接続済み", "connecting" => "セッションを同期中…", "unavailable" => "同期に再接続しています", _ => "" };
        if (syncText.Length > 0) _status.Children.Add(StatusChip(Ui.Text(syncText, 12, "#FFFFFF")));
        if (_ctx.State.WorldPending is { } pending)
        {
            var seconds = Math.Max(0, Math.Ceiling((J.Number(pending, "at") - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _ctx.State.ServerOffset) / 1000));
            _status.Children.Add(Panel(Ui.Text($"{J.Label(J.Text(pending, "world"))} に切り替わります · {seconds:0}", 14)));
        }
        var target = J.Text(me, "follow");
        if (target != "")
        {
            var name = J.Text(Participants().FirstOrDefault(x => J.Text(x, "id") == target), "name", target);
            _status.Children.Add(StatusChip(Ui.Row(IconLabel("follow", name + " についていっています", 14, 12, "#FFFFFF"), ChipButton("ライブをリクエスト", () => SendRoom(new { t = "liveRequest", to = target })), ChipButton("やめる", () => SendRoom(new { t = "follow", target = (string?)null })))));
        }
        else if (me?["pos"] is JsonObject) _status.Children.Add(StatusChip(Ui.Row(IconLabel("pin", "3D 空間の中にいます", 14, 12, "#FFFFFF"), ChipButton("スポーンに戻る", () => SendRoom(new { t = "place2d", target = _ctx.State.SelfId, pos = (object?)null })))));
    }
    private void MarkNoticesRead()
    {
        foreach (var notice in _ctx.State.Notifications.OfType<JsonObject>()) notice["unread"] = false;
        _ctx.State.Touch();
    }
    private void Soundboard()
    {
        var grid = new WrapPanel { MaxWidth = 300 };
        foreach (var (id, label) in new[] { ("clap", "拍手"), ("laugh", "わはは"), ("wow", "おお〜"), ("drum", "ドラム"), ("bell", "チャイム"), ("boo", "ブブー") })
        { var b = Ui.Button(label, () => SendRoom(new { t = "sound", id })); b.Width = 78; b.Height = 44; b.Padding = new Thickness(4); b.Margin = new Thickness(2); b.Background = Brush.Parse("#F3EEE4"); grid.Children.Add(b); }
        ShowPopup(Ui.Column(Ui.Text("サウンドボード（近くの人に聞こえます）", 12, Ui.Muted), grid), 290);
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
        await ShareMediaFilesAsync(files, asItem, useDraft: !asItem);
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
        var id = J.Text(user, "id"); var portrait = new AvatarPortrait(_ctx, id) { Height = 320, Width = 380 };
        var content = Ui.Column(Ui.Title(J.Text(user, "name")), portrait, Ui.Button("プロフィール", () => _ctx.OpenProfile(id)));
        if (J.Bool(user, "sharing")) content.Children.Add(ActionButton("screen", "ライブを見る", () => OpenLive(id)));
        var window = ShowPopup(content, 430); _portraitWindowCount++; Fit(); window.Closed += (_, _) => { _portraitWindowCount--; Fit(); };
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
    private void SetWindowMode(bool free) { RoomWindowLayout.Free = free; NativeSettings.SetBool("room.freeWindows", free); StyleWindowModes(); _ctx.Notify(free ? "フリー：ウィンドウを自由に動かせます" : "カンタン：アイテムを中央に表示します"); }
    private void WindowOptions() => ShowPopup(Ui.Column(Ui.Title("ウィンドウの表示"), Ui.Button("カンタン — 開いたものを中央に表示", () => SetWindowMode(false)), Ui.Button("フリー — 自由に動かす", () => SetWindowMode(true))), 380);
    private void ToggleLeft() { if (_sidePanelsStowed) { _sidePanelsStowed = false; _leftHidden = false; } else _leftHidden = !_leftHidden; NativeSettings.SetBool("room.leftFolded", _leftHidden); Fit(); }
    private void ToggleRight() { if (_sidePanelsStowed) { _sidePanelsStowed = false; _rightHidden = false; } else _rightHidden = !_rightHidden; NativeSettings.SetBool("room.rightFolded", _rightHidden); Fit(); }
    private void Fit()
    {
        var compact = Bounds.Width < 1080; _left.Width = compact ? 260 : 320; _right.Width = compact ? 275 : 300;
        // Tabでの退避は一時的にし、2Dのパネル設定を上書きしない。
        _left.IsVisible = !_leftHidden; _right.IsVisible = !_rightHidden;
        _leftFold.IsVisible = _leftHidden || _sidePanelsStowed; _rightFold.IsVisible = _rightHidden || _sidePanelsStowed;
        _left.Margin = new Thickness(_sidePanelsStowed ? -_left.Width - 12 : 20, 74, 0, 20);
        _right.Margin = new Thickness(0, 20, _sidePanelsStowed ? -_right.Width - 12 : 20, 20);
        _itemScroll.MaxHeight = Math.Max(100, (Bounds.Height - 94) * .42);
        var left = _leftHidden || _sidePanelsStowed ? 92 : _left.Width + 40; var right = _rightHidden || _sidePanelsStowed ? 92 : _right.Width + 40;
        _center.Margin = new Thickness(left, Gallery && !_facesHidden ? 90 : 16, right, Gallery && !_facesHidden ? 144 : 0);
        _center.VerticalAlignment = Gallery && !_facesHidden ? VerticalAlignment.Stretch : VerticalAlignment.Top;
        // Keep the Unity stage inside the same native-panel safe area as before.
        _threeDSurface.Margin = new Thickness(left, 90, right, 100);
        RebuildFaces(Participants());
    }
    private static string UserColor(string id)
    {
        uint hash = 0; foreach (var c in id) hash = unchecked(hash * 31 + c);
        var hue = hash % 360 / 60d; const double chroma = .585; var x = chroma * (1 - Math.Abs(hue % 2 - 1));
        var (r, g, b) = hue switch { < 1 => (chroma, x, 0d), < 2 => (x, chroma, 0d), < 3 => (0d, chroma, x), < 4 => (0d, x, chroma), < 5 => (x, 0d, chroma), _ => (chroma, 0d, x) };
        return Color.FromRgb((byte)Math.Round((r + .2575) * 255), (byte)Math.Round((g + .2575) * 255), (byte)Math.Round((b + .2575) * 255)).ToString();
    }
    private static string PortraitColor(string id) { var c = Color.Parse(UserColor(id)); return Color.FromRgb((byte)(c.R * .2 + 255 * .8), (byte)(c.G * .2 + 255 * .8), (byte)(c.B * .2 + 255 * .8)).ToString(); }
    private static Border Dot(string color, double size) => new() { Width = size, Height = size, Background = Brush.Parse(color), CornerRadius = new CornerRadius(size / 2), VerticalAlignment = VerticalAlignment.Center };
    private static Border Pill(string text, string background, string color) => new() { Child = Ui.Text(text, 10, color), Background = Brush.Parse(background), CornerRadius = new CornerRadius(99), Padding = new Thickness(6, 1), VerticalAlignment = VerticalAlignment.Center };
    private static Border StatusChip(Control child) => new() { Child = child, Background = Brush.Parse("#DB26262E"), CornerRadius = new CornerRadius(99), Padding = new Thickness(14, 5, 6, 5) };
    private static Button ChipButton(string label, Action action) { var button = Small(label, action); button.Background = Brushes.White; button.CornerRadius = new CornerRadius(99); button.Height = 26; button.Padding = new Thickness(10, 0); button.FontSize = 11; return button; }
    private static Control Separator(bool dark) => new Border { Width = 1, Height = dark ? 32 : 20, Background = Brush.Parse(dark ? "#4A4B55" : "#2426262E"), VerticalAlignment = VerticalAlignment.Center };
    private static Control PanelSplit() => new Border { Height = 12, BorderBrush = Brush.Parse("#1926262E"), BorderThickness = new Thickness(0, 1, 0, 0), Child = new Border { Width = 36, Height = 4, CornerRadius = new CornerRadius(2), Background = Brush.Parse("#2E26262E"), VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center } };
    private static Control PanelHeader(string title, TextBlock? count, Control action)
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto"), ColumnSpacing = 8, Margin = new Thickness(14, 12, 10, 6) };
        var heading = Ui.Text(title, 15); heading.FontWeight = FontWeight.Bold; grid.Children.Add(heading);
        if (count is not null) { Grid.SetColumn(count, 1); grid.Children.Add(count); }
        Grid.SetColumn(action, 2); grid.Children.Add(action); return grid;
    }
    private static Button IconButton(string icon, string name, Action action, double size = 16)
    {
        var b = Small("", action); b.Content = new WebIcon(icon, size); b.Width = b.Height = 30; b.Padding = new Thickness(0); b.CornerRadius = new CornerRadius(8); ToolTip.SetTip(b, name); AutomationProperties.SetName(b, name); return b;
    }
    private static Button ActionButton(string icon, string name, Action action)
    {
        var button = Ui.Button(name, action); button.Content = IconLabel(icon, name, 16, 13); button.HorizontalContentAlignment = HorizontalAlignment.Left; AutomationProperties.SetName(button, name); return button;
    }
    private static Button DockButton(string icon, string name, Action action)
    {
        var b = IconButton(icon, name, action, 22); b.Content = new WebIcon(icon, 22, Brushes.White); b.Width = b.Height = 52; b.CornerRadius = new CornerRadius(16); b.Background = Brush.Parse("#3A3B44"); return b;
    }
    private static Button FoldedPanel(bool left, Action action)
    {
        var b = Small("", action); var content = Ui.Column(new WebIcon(left ? "right" : "left", 14), new WebIcon(left ? "people" : "bell", 18), Separator(false), new WebIcon(left ? "box" : "chat", 18)); content.Spacing = 12;
        foreach (var child in content.Children) child.HorizontalAlignment = HorizontalAlignment.Center;
        b.Content = content; b.Width = 52; b.Padding = new Thickness(0, 12); b.Background = Brush.Parse("#EBFFFDF9"); b.CornerRadius = new CornerRadius(18); AutomationProperties.SetName(b, left ? "プレイヤーとアイテムを開く" : "通知とログを開く"); return b;
    }
    private void StyleWindowModes()
    {
        foreach (var (button, selected) in new[] { (_simpleMode, !RoomWindowLayout.Free), (_freeMode, RoomWindowLayout.Free) })
        {
            button.Background = selected ? Brushes.White : Brushes.Transparent; button.Foreground = Brush.Parse(selected ? Ui.Ink : "#B9B7C2");
            var text = selected ? Ui.Ink : "#B9B7C2"; button.Content = Ui.Row(new WebIcon(button == _simpleMode ? "window" : "layers", 15, Brush.Parse(text)), Ui.Text(button == _simpleMode ? "カンタン" : "フリー", 11, text));
        }
    }
    private void SelectScope(int index)
    {
        _scopeIndex = index;
        for (var i = 0; i < _scopeButtons.Length; i++) { _scopeButtons[i].Background = i == index ? Brushes.White : Brushes.Transparent; _scopeButtons[i].FontWeight = i == index ? FontWeight.Bold : FontWeight.Normal; }
        _input.PlaceholderText = index == 0 ? "声の届く範囲（〜15m）に送信" : index == 1 ? "セッション全体に送信" : "アナウンスを送信";
    }
    private static string Time(double at) => at > 0 ? DateTimeOffset.FromUnixTimeMilliseconds((long)at).ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture) : "";
    private static Control Empty(string text) => new Border { Padding = new Thickness(6, 16), Child = Ui.Text(text, 12, Ui.Muted) };
    private static TextBlock CenterText(string text, double size) { var t = Ui.Text(text, size); t.HorizontalAlignment = HorizontalAlignment.Center; t.VerticalAlignment = VerticalAlignment.Center; return t; }
    private static Control IconLabel(string icon, string text, double size = 16, double fontSize = 12, string? color = null)
    {
        var row = (StackPanel)Ui.IconText(icon, text, size); row.Spacing = 5;
        foreach (var child in row.Children) { if (child is TextBlock label) { label.FontSize = fontSize; label.Foreground = Brush.Parse(color ?? Ui.Ink); } else if (child is WebIcon mark) mark.Foreground = Brush.Parse(color ?? Ui.Ink); }
        return row;
    }
    private static Button Small(string label, Action action) { var b = Ui.Button(label, action); b.MinWidth = 0; b.MinHeight = 0; b.Padding = new Thickness(8, 6); b.FontSize = 12; b.Background = Brushes.Transparent; b.BorderThickness = new Thickness(0); if (label.Length > 0) AutomationProperties.SetName(b, label); return b; }
    private static Border Panel(Control child) => new() { Child = child, CacheMode = new BitmapCache(), Padding = new Thickness(13), Background = Brush.Parse("#DBFFFDF9"), CornerRadius = new CornerRadius(20), BorderBrush = Brush.Parse("#B3FFFFFF"), BorderThickness = new Thickness(1), BoxShadow = new BoxShadows(new BoxShadow { Blur = 30, OffsetY = 8, Color = Color.Parse("#1F3C280A") }) };
    private Window ShowPopup(Control body, double width) { var window = new Window(); ConfigurePopup(window, body, width); window.Show(_ctx.Owner); return window; }
    private void ConfigurePopup(Window window, Control body, double width) { window.Title = "Tonarium"; window.Width = width; window.SizeToContent = SizeToContent.Height; window.MaxHeight = 720; window.MinHeight = 160; window.WindowStartupLocation = WindowStartupLocation.CenterOwner; window.Background = Brush.Parse(Ui.Paper); window.Content = new ScrollViewer { Content = new Border { Padding = new Thickness(22), Child = body }, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled }; }
    private void SendRoom(object message) => Run(() => _ctx.Client.SendRoomAsync(message));
    private async void Run(Func<Task> action) { try { await action(); } catch (Exception e) { _ctx.Notify(e.Message); } }

}

/// <summary>Shared by the native item window manager, without affecting networking.</summary>
public static class RoomWindowLayout { public static bool Free { get; set; } = NativeSettings.GetBool("room.freeWindows"); }

internal sealed class RoomBackdrop : Control
{
    public override void Render(DrawingContext context)
    {
        base.Render(context); WebGround.Draw(context, Bounds.Size);
    }
}
