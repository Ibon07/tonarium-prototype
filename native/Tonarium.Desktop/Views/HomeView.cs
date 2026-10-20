using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Presenters;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

/// <summary>The native social client. No WebView is used for any of these screens.</summary>
public sealed class HomeView : UserControl
{
    readonly NativeContext _context;
    readonly Dictionary<string, string> _drafts = new();
    readonly Dictionary<string, TextBox> _inputs = new();
    readonly Dictionary<string, Button> _nav = new();
    readonly Dictionary<string, Bitmap> _imageCache = new();
    static readonly HttpClient Http = new();
    readonly ContentControl _pageHost = new();
    readonly StackPanel _groupNav = new() { Spacing = 5 };
    readonly StackPanel _aside = new() { Spacing = 14 };
    readonly TextBlock _heading = Text("ホーム", 26, weight: FontWeight.Bold);
    readonly TextBlock _self = Text("", 14, weight: FontWeight.SemiBold);
    readonly TextBlock _status = Text("", 11, Muted);
    readonly ContentControl _selfFace = new();
    Button? _mode2d, _mode3d;
    Button? _bell;
    readonly ScrollViewer _scroll;
    readonly Grid _root;
    string _page = "home", _group = "", _channel = "", _dm = "", _tab = "all", _signature = "";
    DateTime _calendarMonth = DateTime.Today;
    DateTime? _pickedDay;
    bool _monthView;
    string _search = "";
    const string Ink = "#26262E", Muted = "#86818A", Paper = "#FFFDF9", Purple = "#5B47A8", Line = "#DCD5C8";
    static readonly (string Id, string Label, string Icon)[] Navigation =
    [ ("home", "ホーム", "⌂"), ("friends", "フレンド", "♧"), ("sessions", "セッション", "◉"), ("events", "イベント", "▦"), ("groups", "グループ", "⚑"), ("worlds", "ワールド", "◎"), ("items", "アイテム", "◇") ];
    static readonly (string Id, string Name, string Desc, string Color)[] Worlds =
    [ ("room", "ホール", "何も置いていない広い部屋", "#DDE6F0"), ("cafe", "カフェ", "カウンターとテーブル席のある落ち着いたカフェ", "#F0E3CD"), ("game", "ゲーム", "板わたりサバイバル。最後まで落ちずに残ろう", "#E8DEF0") ];
    static readonly (string Id, string Name, string Mark, string Desc, string Color)[] Items =
    [ ("note", "付箋", "付", "文字を書いて置いておける付箋。2D と 3D の両方で読み書きできます。", "#FBF1C4"), ("hammer", "ピコピコハンマー", "槌", "手に持って誰かを叩ける、ちょっとした遊び道具。", "#FBE3D2"), ("chess", "チェス", "♟", "みんなで同じ盤面を囲んでチェスを遊べます。", "#E3E7F6"), ("chessAi", "チェスAI", "♟AI", "白はあなた、黒はAI。みんなで相談して対戦。", "#DFEEE8"), ("g2048", "2048", "2048", "みんなで操作できる、数字を重ねるパズル。", "#F4EBCF"), ("canvas", "キャンバス", "画", "ペンと消しゴムで、みんなで絵を描けます。", "#F6E4EC"), ("camera", "カメラ", "写", "3D 空間で写真を撮ったり、視点をライブ配信。", "#E5F0E9"), ("dice", "サイコロ", "賽", "d4〜d100、最大10個。結果はチャットにも残ります。", "#F3E6D3") ];

    public HomeView(NativeContext context)
    {
        _context = context;
        Background = Brush("#EAE5DB");
        _root = new Grid { ColumnDefinitions = new ColumnDefinitions("216,*,258"), Margin = new Thickness(20), ColumnSpacing = 22 };
        _root.Children.Add(BuildSidebar());
        var center = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), RowSpacing = 20 };
        Grid.SetColumn(center, 1);
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("*,210,Auto"), ColumnSpacing = 12 };
        top.Children.Add(_heading);
        var search = new TextBox { PlaceholderText = "検索", CornerRadius = new CornerRadius(18), Background = Brush(Paper), FontSize = 12, MinHeight = 36 };
        search.TextChanged += (_, _) => { _search = search.Text ?? ""; RenderPage(); };
        Grid.SetColumn(search, 1); top.Children.Add(search);
        _bell = Btn("♧  通知", () => Navigate("notifications")); Grid.SetColumn(_bell, 2); top.Children.Add(_bell);
        center.Children.Add(top);
        _scroll = new ScrollViewer { Content = _pageHost, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        Grid.SetRow(_scroll, 1); center.Children.Add(_scroll); _root.Children.Add(center);
        var asideScroll = new ScrollViewer { Content = _aside, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        Grid.SetColumn(asideScroll, 2); _root.Children.Add(asideScroll);
        Content = _root;
        SizeChanged += (_, _) => { var narrow = Bounds.Width < 1050; _root.ColumnDefinitions[2].Width = narrow ? new GridLength(0) : new GridLength(258); asideScroll.IsVisible = !narrow; };
        Refresh();
    }

    Control BuildSidebar()
    {
        var body = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };
        var brand = Row(Mark("と", "#D2AF91", 34), Text("トナリウム", 17, weight: FontWeight.Bold)); brand.Margin = new Thickness(8, 4, 0, 20); body.Children.Add(brand);
        var links = Col(3);
        foreach (var (id, label, icon) in Navigation) { var b = Btn($"{icon}   {label}", () => Navigate(id)); b.HorizontalContentAlignment = HorizontalAlignment.Left; b.HorizontalAlignment = HorizontalAlignment.Stretch; b.Height = 40; b.Background = Brushes.Transparent; links.Children.Add(b); _nav[id] = b; }
        var groups = Col(9); groups.Margin = new Thickness(8, 22, 8, 0); groups.Children.Add(Text("所属グループ", 11, Muted, FontWeight.SemiBold)); groups.Children.Add(_groupNav);
        var navigationScroll = new ScrollViewer
        {
            Content = Col(0, links, groups),
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto
        };
        Grid.SetRow(navigationScroll, 1); body.Children.Add(navigationScroll);
        var bottom = Col(11); bottom.Margin = new Thickness(0, 12, 0, 0);
        bottom.Children.Add(Text("クライアントモード", 11, Muted));
        _mode2d=Btn("▤ 2D", () => Run(() => _context.ChangeModeAsync("2d")));_mode3d=Btn("◇ 3D", () => Run(() => _context.ChangeModeAsync("3d")));bottom.Children.Add(Row(_mode2d,_mode3d));
        bottom.Children.Add(new Border { Height = 1, Background = Brush(Line), Margin = new Thickness(0, 5) });
        _selfFace.Content=Mark("●", "#DAE5D6", 34);bottom.Children.Add(Row(_selfFace, Col(2, _self, _status)));
        bottom.Children.Add(Row(Btn("ステータス", StatusDialog), Btn("⚙", () => _context.OpenProfile(_context.State.Name))));
        Grid.SetRow(bottom, 2); body.Children.Add(bottom);
        return new Border { Background = Brush(Paper), CornerRadius = new CornerRadius(20), Padding = new Thickness(14), Child = body };
    }

    public void Navigate(string page)
    {
        if (page.StartsWith("dm:")) { _dm = page[3..]; page = "friends"; _tab = "all"; }
        if (page.StartsWith("group:")) { _group = page[6..]; _channel = ""; page = "group"; }
        _page = page; _scroll.Offset = default; RenderPage();
    }
    public void Refresh()
    {
        var s = _context.State;
        _self.Text = s.Name;
        _status.Text = s.Connected ? "● " + StatusName(T(UserByName(s.Name),"status","online")) : "○ 接続待ち";
        if(_bell!=null)_bell.Content="♧  通知"+(s.Notifications.Count>0?"  "+s.Notifications.Count:"");
        if(_mode2d!=null)_mode2d.Background=Brush(s.Mode=="2d"?"#DAD1E6":"#F0EBE5");if(_mode3d!=null)_mode3d.Background=Brush(s.Mode=="3d"?"#DAD1E6":"#F0EBE5");
        // Room position packets arrive frequently. They must never rebuild text inputs.
        var signature = string.Join("|", s.Name, s.SessionId, s.Sessions.ToJsonString(), s.Groups.ToJsonString(), s.Events.ToJsonString(), s.Friends.ToJsonString(), s.People.ToJsonString(), s.Conversations.ToJsonString(), s.Notifications.ToJsonString(), s.SessionInfo.ToJsonString(), string.Join(";", s.Users.Select(u => $"{T(u,"id")}:{T(u,"name")}:{T(u,"session")}:{T(u,"status")}:{T(u,"statusText")}:{T(u,"icon")}")));
        if (signature == _signature) return;
        _signature = signature;
        _selfFace.Content=Face(s.Name,34);
        _groupNav.Children.Clear();
        foreach (var g in s.Groups.Where(IsMember)) { var id = T(g, "id"); var b = Btn("●  " + T(g, "name"), () => Navigate("group:" + id)); b.Background = Brushes.Transparent; b.HorizontalContentAlignment = HorizontalAlignment.Left; _groupNav.Children.Add(b); }
        if (_groupNav.Children.Count == 0) _groupNav.Children.Add(Text("まだありません", 11, Muted));
        RenderPage(); RenderAside();
    }

    void RenderPage()
    {
        var focused = TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() as TextBox;
        var focusKey = _inputs.FirstOrDefault(x => x.Value == focused).Key;
        var caret = focused?.CaretIndex ?? 0;
        var offset = _scroll.Offset; _inputs.Clear();
        foreach (var pair in _nav) pair.Value.Background = pair.Key == _page ? Brush("#ECE5F1") : Brushes.Transparent;
        _heading.Text = Navigation.FirstOrDefault(n => n.Id == _page).Label ?? (_page == "group" ? T(Find(_context.State.Groups, _group), "name", "グループ") : "通知");
        _pageHost.Content = _page switch
        {
            "friends" => FriendsPage(), "sessions" => SessionsPage(), "groups" => GroupsPage(), "group" => GroupPage(), "events" => EventsPage(), "worlds" => WorldsPage(), "items" => ItemsPage(), "notifications" => NotificationsPage(), _ => Dashboard()
        };
        Dispatcher.UIThread.Post(() => { _scroll.Offset = offset; if (focusKey != null && _inputs.TryGetValue(focusKey, out var replacement)) { replacement.Focus(); replacement.CaretIndex = Math.Min(caret, replacement.Text?.Length ?? 0); } });
    }

    Control Dashboard()
    {
        var s = _context.State; var col = Col(20);
        var greeting = Col(7, Text($"こんにちは、{s.Name} さん", 23, weight: FontWeight.Bold), Text("だれかのとなりに、ふらっと。", 13, Muted));
        var hero = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(4) };
        hero.Children.Add(greeting); var create = Btn("＋ セッションを作る", () => CreateSession(), true); Grid.SetColumn(create, 1); hero.Children.Add(create); col.Children.Add(hero);
        if (s.SessionId != null) col.Children.Add(CurrentSession());
        var friends = s.Users.Where(u => u != null && FriendNames.Contains(T(u,"name")) && Match(T(u,"name"))).ToArray();
        col.Children.Add(Section("フレンドの今", $"{friends.Length} 人がオンライン", () => Navigate("friends")));
        if (friends.Length == 0) col.Children.Add(Empty("いまは静かです", "フレンドが来たら、ここで見つけられます。"));
        else foreach (var friend in friends.Take(5)) col.Children.Add(FriendRow(friend));
        col.Children.Add(Section("参加できるセッション", $"{s.Sessions.Count} 件", () => Navigate("sessions")));
        col.Children.Add(SessionGrid(s.Sessions.Where(x => Match(T(x,"name"), T(x,"topic"))).Take(6)));
        col.Children.Add(Section("最近のやりとり", "メッセージとグループの会話"));
        var conversations = s.Conversations.OrderByDescending(k => N((k.Value as JsonArray)?.LastOrDefault(),"at")).Take(5).ToArray();
        if (conversations.Length == 0) col.Children.Add(Empty("まだやりとりはありません", "フレンドやグループにメッセージを送ってみよう。"));
        foreach (var pair in conversations)
        {
            var key = pair.Key; var last = (pair.Value as JsonArray)?.LastOrDefault();
            var b = Btn("", () => OpenConversation(key)); b.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            b.Content = Row(Mark(key.StartsWith("dm:") ? "✉" : "#", "#E8E1ED", 32), Col(4, Text(ConversationTitle(key), 13, weight: FontWeight.SemiBold), Text(T(last,"text", "共有されたメッセージ"), 12, Muted)));
            b.Background = Brush(Paper); b.Padding = new Thickness(15); col.Children.Add(b);
        }
        return col;
    }
    Control CurrentSession()
    {
        var s = _context.State; var session = Find(s.Sessions, s.SessionId ?? "");
        return Card(Row(Text("● 参加中", 12, "#519369"), Col(4, Text(T(session,"name", "セッション"), 14, weight: FontWeight.SemiBold), Text(WorldName(s.World), 11, Muted)), Btn("戻る", () => _context.ShowHome("close")), Btn("離脱", () => Run(() => _context.Client.LeaveAsync()))));
    }
    Control SessionsPage() { var c = Col(18); if (_context.State.SessionId != null) c.Children.Add(CurrentSession()); c.Children.Add(Section("参加できるセッション", $"{_context.State.Sessions.Count} 件", () => CreateSession(), "＋ 作る")); c.Children.Add(SessionGrid(_context.State.Sessions.Where(x => Match(T(x,"name"),T(x,"topic"))))); return c; }
    Control SessionGrid(IEnumerable<JsonNode?> sessions)
    {
        var grid = new WrapPanel { Orientation = Orientation.Horizontal, ItemSpacing = 14, LineSpacing = 14 };
        foreach (var s in sessions) if (s != null) grid.Children.Add(SessionCard(s));
        if (grid.Children.Count == 0) return Empty("セッションが見つかりません", "セッションを作って、みんなを誘ってみよう。");
        return grid;
    }
    Control SessionCard(JsonNode s)
    {
        var id = T(s,"id"); var world = T(s,"world","room");
        var summary = _context.State.SessionInfo[id]; if (summary != null) world = T(summary,"world",world);
        var members = _context.State.Users.Where(u => T(u,"session") == id).ToArray();
        var stack = Col(0);
        stack.Children.Add(new HomeRoomPreview(world, members.Length) { Height = 116 });
        var content = Col(9); content.Margin = new Thickness(14);
        content.Children.Add(Row(Text(WorldName(world), 11, Muted), Text(VisibilityName(T(s,"visibility","public")), 10, Purple)));
        content.Children.Add(Text(T(s,"name"), 16, weight: FontWeight.SemiBold));
        var topic = T(s,"topic"); if (topic.Length > 0) content.Children.Add(Text(topic, 11, Muted));
        content.Children.Add(Text(members.Length > 0 ? string.Join("、", members.Take(4).Select(x => T(x,"name"))) : "まだだれもいません", 11, Muted));
        var controls = Row(Text($"{members.Length} 人", 11, Muted), Btn(_context.State.SessionId == id ? "戻る →" : "参加する →", () => {if(_context.State.SessionId==id)_context.ShowHome("close");else Run(() => _context.Client.JoinAsync(id));}, true));
        if (T(s,"owner") == _context.State.Name) controls.Children.Add(Btn("削除", () => Confirm("セッションを削除", "このセッションを削除しますか？", () => Send(new { t = "sessionDelete", id }))));
        content.Children.Add(controls); stack.Children.Add(content);
        return new Border { Width = 269, Background = Brush(Paper), CornerRadius = new CornerRadius(17), ClipToBounds = true, Child = stack, BorderBrush = Brush(Line), BorderThickness = new Thickness(1) };
    }

    Control FriendsPage()
    {
        var root = Col(17); root.Children.Add(Row(Tab("すべて", "all"), Tab("リクエスト", "requests"), Tab("さがす", "discover")));
        if (_tab == "requests") return Col(16, root, NotificationsPage(true));
        if (_tab == "discover") { foreach (var u in _context.State.Users.Where(x => T(x,"name") != _context.State.Name && !FriendNames.Contains(T(x,"name")) && Match(T(x,"name")))) root.Children.Add(FriendRow(u, true)); if (root.Children.Count == 1) root.Children.Add(Empty("見つかりません", "ほかのユーザーが接続するとここに表示されます。")); return root; }
        var names = FriendNames.Where(n => Match(n)).ToArray();
        if (names.Length == 0) { root.Children.Add(Empty("まだフレンドがいません", "セッションのプロフィールや「さがす」からフレンド申請できます。")); return root; }
        if (!names.Contains(_dm)) _dm = names[0];
        var split = new Grid { ColumnDefinitions = new ColumnDefinitions("220,*"), ColumnSpacing = 16 };
        var list = Col(7);
        foreach (var name in names) { var b = Btn("", () => { _dm = name; RenderPage(); }); b.Content = Row(Face(name,32), Col(4, Text(name, 13, weight: FontWeight.SemiBold), Text(UserByName(name) != null ? "● オンライン" : "○ オフライン", 10, Muted))); b.Background = name == _dm ? Brush("#ECE5F1") : Brush(Paper); b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Left; b.Padding = new Thickness(11); list.Children.Add(b); }
        split.Children.Add(list);
        var chat = Col(15); chat.Children.Add(FriendRow(UserByName(_dm) ?? new JsonObject { ["id"] = _dm, ["name"] = _dm })); chat.Children.Add(Conversation(DmKey(_dm), _dm + " にメッセージを送信")); Grid.SetColumn(chat,1); split.Children.Add(chat); root.Children.Add(split); return root;
    }
    Button Tab(string title, string tab) { var b = Btn(title, () => { _tab = tab; RenderPage(); }); if (_tab == tab) b.Background = Brush("#E8DFEF"); return b; }
    Control FriendRow(JsonNode? u, bool request = false)
    {
        var name = T(u,"name"); var id = T(u,"id", name); var online = UserByName(name) != null;
        var sessionId = T(u,"session"); var session = Find(_context.State.Sessions, sessionId);
        var details = session != null ? T(session,"name") + " にいます" : online ? "オンライン" : "オフライン";
        var row = Row(BtnFace(name, () => _context.OpenProfile(name)), Col(3, Text(name, 14, weight: FontWeight.SemiBold), Text(T(u,"statusText",details) is { Length: > 0 } st ? st : details, 11, Muted)));
        if (request) row.Children.Add(Btn("申請する", () => { Send(new { t = "friendRequest", to = id }); _context.Notify(name + " にフレンド申請を送りました"); }));
        else { row.Children.Add(Btn("✉", () => Navigate("dm:" + name))); if (session != null && T(u,"status") != "busy") row.Children.Add(Btn(T(u,"status") == "askMe" ? "行ってもいい？" : "参加", () => { if (T(u,"status") == "askMe") Send(new { t = "askJoin", to = id }); else Run(() => _context.Client.JoinAsync(sessionId)); })); if (online) row.Children.Add(Btn("誘う", () => InviteDialog(id))); else row.Children.Add(Btn("来たら知らせる", () => { Send(new { t = "watch", name, on = true }); _context.Notify("オンライン通知を設定しました"); })); }
        return Card(row);
    }

    Control GroupsPage()
    {
        var c = Col(14); c.Children.Add(Section("グループ", "いつもの仲間と、いつもの場所", CreateGroup, "＋ 作る"));
        foreach (var g in _context.State.Groups.Where(x => Match(T(x,"name"))))
        {
            var id = T(g,"id"); var name = T(g,"name"); var member = IsMember(g);
            c.Children.Add(Card(Row(Mark(Initial(name), T(g,"color","#9E8DAC"), 42), Col(5, Link(name, () => Navigate("group:" + id)), Text($"{A(g,"members").Count} 人 · {T(g,"owner")} が作成", 11, Muted)), Btn(member ? "開く →" : "入る", () => { if (member) Navigate("group:" + id); else Send(new { t = "groupJoin", id }); }), Btn(member ? "抜ける" : "見る", () => { if (member) Confirm("グループから抜ける", name + " から抜けますか？", () => Send(new { t = "groupLeave", id })); else Navigate("group:" + id); }))));
        }
        if (c.Children.Count == 1) c.Children.Add(Empty("グループはまだありません", "同じ趣味の仲間や友だちのグループを作れます。")); return c;
    }
    Control GroupPage()
    {
        var g = Find(_context.State.Groups,_group); if (g == null) return Empty("グループが見つかりません", "一覧からグループを選び直してください。");
        var member = IsMember(g); var c = Col(18);
        var actions = Row(Text($"{A(g,"members").Count} 人のメンバー", 12, Muted));
        if (member) { actions.Children.Add(Btn("＋ セッション", () => CreateSession("room",_group), true)); actions.Children.Add(Btn("フレンドを誘う", () => InviteToGroup(_group))); actions.Children.Add(Btn("抜ける", () => Confirm("グループから抜ける", T(g,"name") + " から抜けますか？", () => { Send(new { t="groupLeave", id=_group }); Navigate("groups"); }))); }
        else actions.Children.Add(Btn("グループに入る", () => Send(new { t="groupJoin", id=_group }), true));
        if(T(g,"owner") == _context.State.Name) actions.Children.Add(Btn("削除",()=>Confirm("グループを削除", "グループとチャンネルを削除しますか？",()=>{ Send(new { t="groupDelete",id=_group });Navigate("groups"); })));
        c.Children.Add(actions); c.Children.Add(Section("セッション", "このグループの集まる場所")); c.Children.Add(SessionGrid(_context.State.Sessions.Where(s => T(s,"group") == _group)));
        if (!member) { c.Children.Add(Empty("チャンネル", "メンバーになると、会話を読んだり書いたりできます。")); return c; }
        var tabs = Row(); var channels = A(g,"channels"); if (!channels.Any(ch=>T(ch,"id")==_channel)) _channel=T(channels.FirstOrDefault(),"id");
        foreach(var ch in channels) { var id=T(ch,"id"); var b=Btn("# "+T(ch,"name"),()=>{_channel=id;RenderPage();}); if(id==_channel)b.Background=Brush("#ECE5F1"); tabs.Children.Add(b); }
        if(T(g,"owner")==_context.State.Name) tabs.Children.Add(Btn("＋",()=>Prompt("チャンネルを作る", "チャンネル名", name=>Send(new{t="channelCreate",group=_group,name}))));
        c.Children.Add(tabs); if(_channel.Length>0)c.Children.Add(Conversation("ch:"+_group+":"+_channel,"チャンネルにメッセージを送信",true));
        c.Children.Add(Section("メンバー", $"{A(g,"members").Count} 人")); var members = new WrapPanel { ItemSpacing=8,LineSpacing=8}; foreach(var n in A(g,"members")){var name=n?.GetValue<string>()??"";members.Children.Add(Btn(name,()=>_context.OpenProfile(name)));} c.Children.Add(members); return c;
    }

    Control Conversation(string key,string watermark,bool allowPlan=false)
    {
        var panel=Col(12);var messages=_context.State.Conversations[key] as JsonArray??new JsonArray();
        var list=Col(12);
        if(messages.Count==0)list.Children.Add(Empty("まだメッセージはありません", "いなくても送っておけます。"));
        foreach(var message in messages.TakeLast(100))
        {
            var from=T(message,"from","システム");var bubble=Col(6,Row(Text(from.Length>0?from:"セッションのまとめ",12,weight:FontWeight.SemiBold),Text(TimeLabel(N(message,"at")),10,Muted)));
            var text=T(message,"text");if(text.Length>0)bubble.Children.Add(Text(text,13));
            if(message?["voice"] is JsonObject voice)bubble.Children.Add(Btn($"▶ 音声メッセージ ({N(voice,"sec"):0} 秒)",()=>HomeVoiceMessage.Play(_context,T(voice,"url"))));
            if(message?["media"] is JsonObject media){if(T(media,"kind")=="image")bubble.Children.Add(MessageImage(T(media,"url")));bubble.Children.Add(Btn("▧ 添付"+(T(media,"kind")=="video"?"動画":"画像")+"を開く",()=>OpenUrl(T(media,"url"))));}
            if(message?["plan"] is JsonObject plan)
            {
                var id=T(message,"id");bubble.Children.Add(Text("▦ "+TimeLabel(N(plan,"at")),13,Purple));
                bubble.Children.Add(Row(Btn("来る",()=>Send(new{t="rsvp",conv=key,id,answer="yes"})),Btn("たぶん",()=>Send(new{t="rsvp",conv=key,id,answer="maybe"})),Btn("むり",()=>Send(new{t="rsvp",conv=key,id,answer="no"}))));
                var answers=plan["answers"] as JsonObject;if(answers!=null&&answers.Count>0)bubble.Children.Add(Text(string.Join(" · ",answers.Select(x=>x.Key+" "+(x.Value?.GetValue<string>() switch{"yes"=>"来る","maybe"=>"たぶん",_=>"むり"}))),11,Muted));
            }
            if(T(message,"invite") is { Length:>0 } sid)bubble.Children.Add(Btn("セッションに参加",()=>Run(()=>_context.Client.JoinAsync(sid)),true));
            if(message?["item"] is JsonObject item)bubble.Children.Add(Btn("◇ "+T(item,"summary","共有アイテム"),()=>Run(async()=>{await _context.Client.JoinAsync(T(item,"session"));_context.OpenItem(T(item,"id"));})));
            if(message?["recap"] is JsonObject recap){bubble.Children.Add(Text(T(recap,"sessionName")+" のまとめ",14,Purple,FontWeight.SemiBold));bubble.Children.Add(Text(string.Join("、",A(recap,"people").Select(n=>n?.GetValue<string>())),11,Muted));foreach(var entry in A(recap,"log").TakeLast(8))bubble.Children.Add(Text(T(entry,"name")+"  "+T(entry,"text"),12));}
            list.Children.Add(Card(bubble,from==_context.State.Name?"#F0EAF3":Paper));
        }
        panel.Children.Add(new ScrollViewer{Content=list,MaxHeight=420,MinHeight=140,HorizontalScrollBarVisibility=Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled});
        var draft=Input("message:"+key,watermark);draft.AcceptsReturn=true;draft.TextWrapping=TextWrapping.Wrap;draft.MinHeight=60;
        void Submit(){var value=draft.Text?.Trim();if(string.IsNullOrEmpty(value))return;Send(new{t="msg",conv=key,text=value});draft.Text="";_drafts["message:"+key]="";draft.Focus();}
        // TextBox consumes Enter in its class handler. Handle the explicit send
        // shortcut in the tunnel route, while leaving IME pre-edit untouched.
        draft.AddHandler(InputElement.KeyDownEvent,(_,e)=>
        {
            if(e.Key!=Key.Enter||!e.KeyModifiers.HasFlag(KeyModifiers.Control))return;
            if(draft.GetVisualDescendants().OfType<TextPresenter>().Any(p=>!string.IsNullOrEmpty(p.PreeditText)))return;
            e.Handled=true;Submit();
        },RoutingStrategies.Tunnel);
        panel.Children.Add(draft);var buttons=new WrapPanel{ItemSpacing=8,LineSpacing=8};foreach(var button in new Control[]{Text("Ctrl + Enter で送信",10,Muted),Btn("送信",Submit,true),Btn("＋ 添付",()=>Run(()=>AttachAsync(key,draft))),Btn("● 音声",()=>HomeVoiceMessage.ShowRecorder(_context,key))})buttons.Children.Add(button);if(allowPlan)buttons.Children.Add(Btn("▦ 日程を相談",()=>PlanDialog(key)));panel.Children.Add(buttons);
        var last=N(messages.LastOrDefault(),"at");if(last>0&&last>N(_context.State.Reads,key))Send(new{t="read",conv=key,at=last});return panel;
    }

    Control EventsPage()
    {
        var c=Col(18);c.Children.Add(Section("イベント",$"{_context.State.Events.Count} 件",CreateEvent,"＋ 作る"));c.Children.Add(Row(Btn("リスト",()=>{_monthView=false;_pickedDay=null;RenderPage();}),Btn("月",()=>{_monthView=true;RenderPage();})));
        if(_monthView)c.Children.Add(Calendar(true));
        var events=_context.State.Events.Where(e=>Match(T(e,"title"))).OrderBy(e=>N(e,"at")).Where(e=>!_pickedDay.HasValue||FromMs(N(e,"at")).Date==_pickedDay.Value.Date).ToArray();
        foreach(var ev in events)c.Children.Add(EventCard(ev));if(events.Length==0)c.Children.Add(Empty("予定はまだありません","みんなで集まる日を決めてみよう。"));return c;
    }
    Control EventCard(JsonNode? ev)
    {
        var id=T(ev,"id");var when=FromMs(N(ev,"at"));var attendees=A(ev,"attendees");var maybe=A(ev,"maybe");var c=Col(9,Text(when.ToString("M月d日 (ddd)  HH:mm",CultureInfo.GetCultureInfo("ja-JP")),12,Purple),Text(T(ev,"title"),16,weight:FontWeight.SemiBold),Text($"来る {attendees.Count} · たぶん {maybe.Count} · {T(ev,"owner")} が作成",11,Muted));
        var b=Row();foreach(var (answer,label) in new[]{("yes","来る"),("maybe","たぶん"),("no","むり")}){var selected=A(ev,answer=="yes"?"attendees":answer=="maybe"?"maybe":"declined").Any(n=>n?.GetValue<string>()==_context.State.Name);var button=Btn(label,()=>Send(new{t="eventAttend",id,answer=selected?null:answer}));if(selected)button.Background=Brush("#E4DCEE");b.Children.Add(button);} var sid=T(ev,"session");if(sid.Length>0)b.Children.Add(Btn("会場へ",()=>Run(()=>_context.Client.JoinAsync(sid)),true));if(T(ev,"owner")==_context.State.Name)b.Children.Add(Btn("削除",()=>Confirm("イベントを削除",T(ev,"title")+" を削除しますか？",()=>Send(new{t="eventDelete",id}))));c.Children.Add(b);return Card(c);
    }
    Control Calendar(bool selectable)
    {
        var c=Col(12);c.Children.Add(Row(Btn("‹",()=>{_calendarMonth=_calendarMonth.AddMonths(-1);RenderAside();if(_monthView)RenderPage();}),Text(_calendarMonth.ToString("yyyy年 M月"),14,weight:FontWeight.SemiBold),Btn("›",()=>{_calendarMonth=_calendarMonth.AddMonths(1);RenderAside();if(_monthView)RenderPage();})));
        var grid=new Grid{ColumnDefinitions=new ColumnDefinitions("*,*,*,*,*,*,*"),RowDefinitions=new RowDefinitions("Auto,Auto,Auto,Auto,Auto,Auto,Auto"),RowSpacing=4,ColumnSpacing=3};
        var labels=new[]{"月","火","水","木","金","土","日"};for(var i=0;i<7;i++){var t=Text(labels[i],10,Muted);t.HorizontalAlignment=HorizontalAlignment.Center;Grid.SetColumn(t,i);grid.Children.Add(t);}
        var first=new DateTime(_calendarMonth.Year,_calendarMonth.Month,1);var lead=((int)first.DayOfWeek+6)%7;
        for(var day=1;day<=DateTime.DaysInMonth(first.Year,first.Month);day++){var date=first.AddDays(day-1);var has=_context.State.Events.Any(e=>FromMs(N(e,"at")).Date==date);var b=Btn(day.ToString()+(has?"·":""),()=>{if(selectable){_pickedDay=_pickedDay==date?null:date;RenderPage();}else{_monthView=true;_pickedDay=date;Navigate("events");}});b.Padding=new Thickness(2,5);b.MinWidth=24;b.FontSize=11;b.Background=date==DateTime.Today?Brush("#D8C7DF"):_pickedDay==date?Brush("#EBDFEF"):Brushes.Transparent;Grid.SetColumn(b,(lead+day-1)%7);Grid.SetRow(b,1+(lead+day-1)/7);grid.Children.Add(b);}c.Children.Add(grid);return Card(c);
    }
    void RenderAside()
    {
        _aside.Children.Clear();_aside.Children.Add(Card(Col(12,Text("これからの予定",14,weight:FontWeight.SemiBold),Text("小さな約束を、ここに。",11,Muted))));_aside.Children.Add(Calendar(false));
        var events=_context.State.Events.Where(e=>N(e,"at")>DateTimeOffset.Now.AddHours(-1).ToUnixTimeMilliseconds()).OrderBy(e=>N(e,"at")).Take(4).ToArray();
        foreach(var e in events){var copy=e;_aside.Children.Add(Card(Col(7,Text(TimeLabel(N(e,"at")),11,Purple),Link(T(e,"title"),()=>Navigate("events")),Text($"来る {A(e,"attendees").Count} · たぶん {A(e,"maybe").Count}",10,Muted))));}
        if(events.Length==0)_aside.Children.Add(Text("予定のない日も、ふらっと。",11,Muted));
        _aside.Children.Add(Card(Col(9,Text("となりにいる、を自由に。",12,Purple,FontWeight.SemiBold),Text("2D で気軽に話す。3D で同じ空間を歩く。今の気分に合わせて切り替えよう。",11,Muted))));
    }

    Control WorldsPage()
    {
        var c=Col(16);if(_context.State.SessionId!=null)c.Children.Add(CurrentSession());c.Children.Add(Text("居場所を選ぶ",18,weight:FontWeight.SemiBold));
        foreach(var w in Worlds.Where(w=>Match(w.Name,w.Desc))){var content=Col(12,new HomeRoomPreview(w.Id,3){Height=150},Text(w.Name,20,weight:FontWeight.SemiBold),Text(w.Desc,12,Muted));if(_context.State.SessionId!=null)content.Children.Add(Btn(_context.State.World==w.Id?"このワールドにいます":"ここに切り替える",()=>Confirm("ワールドを切り替える", "セッション全員のワールドを「"+w.Name+"」に切り替えます。",()=>Run(()=>_context.Client.SendRoomAsync(new{t="world",world=w.Id}))),true));else content.Children.Add(Btn("ここでセッションを作る",()=>CreateSession(w.Id),true));c.Children.Add(Card(content));}return c;
    }
    Control ItemsPage()
    {
        var c=Col(16,Section("アイテム",_context.State.SessionId!=null?"目の前に出せる":"セッションの中で使えます"));
        foreach(var item in Items.Where(i=>Match(i.Name,i.Desc))){var row=Row(Mark(item.Mark,item.Color,48),Col(6,Text(item.Name,15,weight:FontWeight.SemiBold),Text(item.Desc,12,Muted),Text(item.Id=="camera"?"3D":"2D  /  3D",10,Purple)));if(_context.State.SessionId!=null){var b=Btn("＋ 出す",()=>Run(async()=>{await _context.Client.SendRoomAsync(new{t="itemCreate",kind=item.Id,x=0,z=1.5,ry=0});_context.Notify(item.Name+" を出しました");}),true);b.IsEnabled=item.Id!="camera"||_context.State.Mode=="3d";row.Children.Add(b);}c.Children.Add(Card(row));}return c;
    }

    Control NotificationsPage(bool onlyFriends=false)
    {
        var c=Col(10);foreach(var n in _context.State.Notifications.ToArray().Where(n=>!onlyFriends||NoticeKind(n)=="friend"))
        {
            var from=T(n,"from");var name=T(n,"fromName",from);var kind=NoticeKind(n);var row=Row(Mark(Initial(name),"#E4DDEB",34),Col(4,Text(name+(kind=="friend"?" からフレンド申請":kind=="online"?" がオンラインになりました":kind=="invite"?" からのお誘い":kind=="askJoin"?" が参加してもよいか聞いています":" からのお知らせ"),13),Text(TimeLabel(N(n,"at")),10,Muted)));
            void Remove(){_context.State.Notifications.Remove(n);_signature="";Refresh();}
            if(kind=="friend")row.Children.Add(Btn("承認",()=>{Send(new{t="friendAccept",to=from});Remove();},true));
            if(kind=="invite"){var key=T(n,"key",T(n,"kind")+":"+T(n,"targetId"));row.Children.Add(Btn("参加",()=>{if(key.StartsWith("group:")){Send(new{t="groupJoin",id=key[6..]});Navigate(key);}else Run(()=>_context.Client.JoinAsync(key.StartsWith("session:")?key[8..]:key));Remove();},true));}
            if(kind=="askJoin"&&_context.State.SessionId is string current)row.Children.Add(Btn("どうぞ",()=>{Send(new{t="invite",kind="session",id=current,to=from});Remove();},true));
            if(kind=="liveRequest")row.Children.Add(Btn("視点ライブを始める",()=>{Run(()=>_context.Client.SendRoomAsync(new{t="viewLive",on=true}));Remove();},true));
            if(kind=="online")row.Children.Add(Btn("メッセージ",()=>{Navigate("dm:"+name);Remove();}));row.Children.Add(Btn("×",Remove));c.Children.Add(Card(row));
        }
        if(c.Children.Count==0)c.Children.Add(Empty("新しい通知はありません","フレンド申請やお誘いが届くと、ここに表示されます。"));return c;
    }

    void CreateSession(string world="room",string? group=null)
    {
        var name=new TextBox{PlaceholderText="セッション名",MaxLength=40};var topic=new TextBox{PlaceholderText="何をする場所か（任意）",MaxLength=100};var worlds=Choice(Worlds.Select(w=>(w.Id,w.Name)),world);
        var visibility=Choice(new[]{("public","パブリック · だれでも"),("friends","フレンド+"),("invite","招待された人だけ"),("group","グループのメンバーだけ"),("groupPlus","グループとフレンド")},group==null?"public":"group");
        var groups=Choice(_context.State.Groups.Where(IsMember).Select(g=>(T(g,"id"),T(g,"name"))),group??"");
        Form("セッションを作る",[("セッション名",name),("トピック",topic),("ワールド",worlds),("公開範囲",visibility),("グループ",groups)],()=>{if(string.IsNullOrWhiteSpace(name.Text))return "セッション名を入力してください。";var vis=Selected(visibility);var gid=group??Selected(groups);if(vis is "group" or "groupPlus"&&gid.Length==0)return "グループを選んでください。";Send(new{t="sessionCreate",name=name.Text.Trim(),topic=topic.Text??"",world=Selected(worlds),visibility=vis,group=vis is "group" or "groupPlus"?gid:null});return null;});
    }
    void CreateGroup()
    {
        var name=new TextBox{PlaceholderText="グループ名",MaxLength=40};var colors=Choice(new[]{("#9E8DAC","ライラック"),("#88A58D","セージ"),("#CD9A77","アプリコット"),("#7C9BB0","ブルー"),("#B98391","ローズ")},"#9E8DAC");
        Form("グループを作る",[("グループ名",name),("色",colors)],()=>{if(string.IsNullOrWhiteSpace(name.Text))return "グループ名を入力してください。";Send(new{t="groupCreate",name=name.Text.Trim(),color=Selected(colors)});return null;});
    }
    void CreateEvent()
    {
        var name=new TextBox{PlaceholderText="イベント名",MaxLength=60};var time=new TextBox{Text=DateTime.Now.AddHours(1).ToString("yyyy-MM-dd HH:00")};var groups=Choice(new[]{("","なし")}.Concat(_context.State.Groups.Where(IsMember).Select(g=>(T(g,"id"),T(g,"name")))));var sessions=Choice(new[]{("","なし")}.Concat(_context.State.Sessions.Select(s=>(T(s,"id"),T(s,"name")))));
        Form("イベントを作る",[("イベント名",name),("日時（例 2026-10-22 20:00）",time),("グループ",groups),("会場のセッション",sessions)],()=>{if(string.IsNullOrWhiteSpace(name.Text))return "イベント名を入力してください。";if(!DateTime.TryParse(time.Text,out var at))return "日時を確認してください。";Send(new{t="eventCreate",title=name.Text.Trim(),at=new DateTimeOffset(at).ToUnixTimeMilliseconds(),group=NullIfEmpty(Selected(groups)),session=NullIfEmpty(Selected(sessions))});return null;});
    }
    void PlanDialog(string conversation)
    {
        var text=new TextBox{PlaceholderText="何をする？"};var time=new TextBox{Text=DateTime.Now.AddDays(1).ToString("yyyy-MM-dd 20:00")};var sessions=Choice(new[]{("","なし")}.Concat(_context.State.Sessions.Select(s=>(T(s,"id"),T(s,"name")))));
        Form("日程を相談する",[("メッセージ",text),("日時",time),("会場",sessions)],()=>{if(!DateTime.TryParse(time.Text,out var at))return "日時を確認してください。";Send(new{t="msg",conv=conversation,text=text.Text??"この日に集まりませんか？",plan=new{at=new DateTimeOffset(at).ToUnixTimeMilliseconds(),session=NullIfEmpty(Selected(sessions))}});return null;},"送信");
    }
    void StatusDialog()
    {
        var self=UserByName(_context.State.Name);var choice=Choice(new[]{("joinMe","参加 OK"),("online","オンライン"),("askMe","声かけて"),("busy","取り込み中")},T(self,"status","online"));var text=new TextBox{Text=T(self,"statusText"),PlaceholderText="いまの気分、ひとこと",MaxLength=32};Form("ステータス",[("今の状態",choice),("ひとこと（32文字）",text)],()=>{Send(new{t="setStatus",status=Selected(choice),text=text.Text??""});return null;},"保存");
    }
    void InviteDialog(string to)
    {
        var options=_context.State.Sessions.Select(s=>("session:"+T(s,"id"),"セッション · "+T(s,"name"))).Concat(_context.State.Groups.Where(IsMember).Select(g=>("group:"+T(g,"id"),"グループ · "+T(g,"name"))));var target=Choice(options);Form("フレンドを誘う",[("誘う場所",target)],()=>{var key=Selected(target);if(key.Length==0)return "セッションまたはグループを選んでください。";var parts=key.Split(':',2);Send(new{t="invite",kind=parts[0],id=parts[1],to});return null;},"誘う");
    }
    void InviteToGroup(string id)
    {
        var choices=Choice(_context.State.Users.Where(u=>FriendNames.Contains(T(u,"name"))).Select(u=>(T(u,"id"),T(u,"name"))));Form("フレンドを誘う",[("オンラインのフレンド",choices)],()=>{var to=Selected(choices);if(to.Length==0)return "オンラインのフレンドがいません。";Send(new{t="invite",kind="group",id,to});return null;},"誘う");
    }
    void Prompt(string title,string label,Action<string> action){var input=new TextBox{PlaceholderText=label};Form(title,[(label,input)],()=>{if(string.IsNullOrWhiteSpace(input.Text))return label+"を入力してください。";action(input.Text.Trim());return null;});}
    void Confirm(string title,string message,Action action)=>Form(title,[("",Text(message,14))],()=>{action();return null;},"続ける");
    void Form(string title,(string Label,Control Control)[] fields,Func<string?> submit,string button="作る")
    {
        var window=new Window{Title=title,Width=460,SizeToContent=SizeToContent.Height,CanResize=false,WindowStartupLocation=WindowStartupLocation.CenterOwner,Background=Brush("#F6F2ED"),ShowInTaskbar=false};var c=Col(14);c.Margin=new Thickness(24);c.Children.Add(Text(title,22,weight:FontWeight.Bold));foreach(var (label,control) in fields){if(label.Length>0)c.Children.Add(Text(label,12,Muted));control.HorizontalAlignment=HorizontalAlignment.Stretch;c.Children.Add(control);}var error=Text("",12,"#AE4949");c.Children.Add(error);c.Children.Add(Row(Btn("やめる",()=>window.Close()),Btn(button,()=>{var problem=submit();if(problem!=null){error.Text=problem;return;}window.Close();},true)));window.Content=c;window.Opened+=(_,_)=>fields.Select(f=>f.Control).OfType<TextBox>().FirstOrDefault()?.Focus();_ = window.ShowDialog(_context.Owner);
    }

    HashSet<string> FriendNames=>_context.State.Friends.Select(n=>n is JsonValue?n.GetValue<string>():T(n,"name")).ToHashSet(StringComparer.Ordinal);
    bool IsMember(JsonNode? group)=>A(group,"members").Any(n=>n?.GetValue<string>()==_context.State.Name);
    JsonNode? UserByName(string name)=>_context.State.Users.FirstOrDefault(u=>T(u,"name")==name);
    bool Match(params string[] values)=>string.IsNullOrWhiteSpace(_search)||values.Any(v=>v.Contains(_search,StringComparison.OrdinalIgnoreCase));
    string DmKey(string name)=>"dm:"+string.Join('\0',new[]{name,_context.State.Name}.OrderBy(n=>n,StringComparer.Ordinal));
    void OpenConversation(string key){if(key.StartsWith("dm:"))Navigate("dm:"+(key[3..].Split('\0').FirstOrDefault(n=>n!=_context.State.Name)??_context.State.Name));else{var parts=key.Split(':');if(parts.Length>=3){_group=parts[1];_channel=parts[2];Navigate("group");}}}
    string ConversationTitle(string key){if(key.StartsWith("dm:"))return(key[3..].Split('\0').FirstOrDefault(n=>n!=_context.State.Name)??_context.State.Name)+" · DM";var p=key.Split(':');if(p.Length<3)return key;var g=Find(_context.State.Groups,p[1]);return T(g,"name","グループ")+" #"+T(A(g,"channels").FirstOrDefault(x=>T(x,"id")==p[2]),"name");}
    void Send(object message)=>Run(()=>_context.Client.SendAsync(message));
    async Task AttachAsync(string conversation,TextBox draft)
    {
        var picker=TopLevel.GetTopLevel(this)?.StorageProvider;if(picker==null)return;
        var files=await picker.OpenFilePickerAsync(new FilePickerOpenOptions{Title="画像・動画を添付",AllowMultiple=false,FileTypeFilter=[new FilePickerFileType("画像・動画"){Patterns=["*.jpg","*.jpeg","*.png","*.gif","*.webp","*.mp4","*.webm"]}]});
        if(files.Count==0)return;
        await using var file=await files[0].OpenReadAsync();using var data=new MemoryStream();await file.CopyToAsync(data);var ext=Path.GetExtension(files[0].Name).ToLowerInvariant();var video=ext is ".mp4" or ".webm";if(data.Length>(video?50:10)*1024*1024){_context.Notify(video?"動画は 50MB までです":"画像は 10MB までです");return;}
        var width=16;var height=9;if(!video){data.Position=0;using var bitmap=new Bitmap(data);width=bitmap.PixelSize.Width;height=bitmap.PixelSize.Height;}
        _context.Notify("添付をアップロードしています…");using var body=new ByteArrayContent(data.ToArray());using var response=await Http.PostAsync(new Uri(new Uri(_context.State.ServerUrl.TrimEnd('/')+"/"),"media"),body);var result=JsonNode.Parse(await response.Content.ReadAsStringAsync());var url=T(result,"url");if(!response.IsSuccessStatusCode||url.Length==0)throw new InvalidOperationException(T(result,"error","アップロードできませんでした"));
        await _context.Client.SendAsync(new{t="msg",conv=conversation,text=draft.Text??"",media=new{kind=video?"video":"image",url,w=width,h=height}});draft.Text="";_drafts["message:"+conversation]="";_context.Notify("添付を送りました");
    }
    Control MessageImage(string url)
    {
        var image=new Image{MaxHeight=240,MaxWidth=480,Stretch=Stretch.Uniform,HorizontalAlignment=HorizontalAlignment.Left};
        if(_imageCache.TryGetValue(url,out var bitmap))image.Source=bitmap;else _=Load();
        return image;
        async Task Load(){try{var bytes=await Http.GetByteArrayAsync(new Uri(new Uri(_context.State.ServerUrl.TrimEnd('/')+"/"),url));using var stream=new MemoryStream(bytes);var loaded=new Bitmap(stream);if(!_imageCache.TryAdd(url,loaded)){loaded.Dispose();loaded=_imageCache[url];}await Dispatcher.UIThread.InvokeAsync(()=>image.Source=loaded);}catch{/* The open-attachment button remains available. */}}
    }
    async void Run(Func<Task> action){try{await action();}catch(Exception ex){_context.Notify(ex.Message);}}
    void OpenUrl(string url){if(url.StartsWith('/'))url=_context.State.ServerUrl.TrimEnd('/')+url;try{System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url){UseShellExecute=true});}catch(Exception ex){_context.Notify(ex.Message);}}
    TextBox Input(string key,string placeholder){var box=new TextBox{PlaceholderText=placeholder,Text=_drafts.GetValueOrDefault(key,""),FontSize=13,CornerRadius=new CornerRadius(10),Background=Brush(Paper)};box.TextChanged+=(_,_)=>_drafts[key]=box.Text??"";_inputs[key]=box;return box;}
    static ComboBox Choice(IEnumerable<(string Id,string Name)> values,string selected=""){var items=values.Select(v=>new ComboBoxItem{Content=v.Name,Tag=v.Id}).ToArray();var cb=new ComboBox{ItemsSource=items,HorizontalAlignment=HorizontalAlignment.Stretch};cb.SelectedItem=items.FirstOrDefault(x=>(string?)x.Tag==selected)??items.FirstOrDefault();return cb;}
    static string Selected(ComboBox choice)=>(choice.SelectedItem as ComboBoxItem)?.Tag as string??"";
    static string? NullIfEmpty(string s)=>s.Length==0?null:s;
    static string NoticeKind(JsonNode? n)=>T(n,"t") switch {"friendRequest"=>"friend","invite"=>"invite",""=>T(n,"kind"),var type=>type};
    static JsonNode? Find(JsonArray a,string id)=>a.FirstOrDefault(n=>T(n,"id")==id);
    static JsonArray A(JsonNode? n,string key)=>n is JsonObject o&&o[key] is JsonArray a?a:new JsonArray();
    static string T(JsonNode? n,string key,string fallback="")=>n is JsonObject o&&o[key] is JsonValue v&&v.TryGetValue<string>(out var s)?s:fallback;
    static double N(JsonNode? n,string key)=>n is JsonObject o&&o[key] is JsonValue v&&(v.TryGetValue<double>(out var d)||double.TryParse(v.ToString(),NumberStyles.Float,CultureInfo.InvariantCulture,out d))?d:0;
    static DateTime FromMs(double value){try{return DateTimeOffset.FromUnixTimeMilliseconds((long)value).LocalDateTime;}catch{return DateTime.Now;}}
    static string TimeLabel(double ms)=>ms>0?FromMs(ms).ToString("M/d HH:mm"):"";
    static string Initial(string s)=>s.Length>0?s[..1]:"?";
    static string WorldName(string id)=>Worlds.FirstOrDefault(w=>w.Id==id).Name??"ホール";
    static string VisibilityName(string id)=>id switch{"friends"=>"フレンド+","group"=>"グループ","groupPlus"=>"グループ+","invite"=>"インバイト",_=>"パブリック"};
    static string StatusName(string id)=>id switch{"joinMe"=>"参加 OK","askMe"=>"声かけて","busy"=>"取り込み中",_=>"オンライン"};
    static IBrush Brush(string color)=>new SolidColorBrush(Color.Parse(color));
    static TextBlock Text(string text,double size=14,string color=Ink,FontWeight? weight=null)=>new(){Text=text,FontSize=size,Foreground=Brush(color),FontWeight=weight??FontWeight.Normal,TextWrapping=TextWrapping.Wrap,VerticalAlignment=VerticalAlignment.Center};
    static StackPanel Col(double spacing=8,params Control[] children){var p=new StackPanel{Spacing=spacing};foreach(var c in children)p.Children.Add(c);return p;}
    static StackPanel Row(params Control[] children){var p=new StackPanel{Orientation=Orientation.Horizontal,Spacing=9,VerticalAlignment=VerticalAlignment.Center};foreach(var c in children)p.Children.Add(c);return p;}
    static Border Card(Control content,string color=Paper)=>new(){Background=Brush(color),BorderBrush=Brush(Line),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(15),Padding=new Thickness(16),Child=content};
    static Control Mark(string text,string color,double size)=>new Border{Width=size,Height=size,Background=Brush(color),CornerRadius=new CornerRadius(size*.3),Child=new TextBlock{Text=text,FontSize=text.Length>2?12:18,Foreground=Brush(Ink),HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center}};
    Control Face(string name,double size)
    {
        var version=T(UserByName(name),"icon");if(version.Length==0)return Mark(Initial(name),"#DCD4E3",size);
        var image=(Image)MessageImage("/icon?name="+Uri.EscapeDataString(name)+"&v="+Uri.EscapeDataString(version));image.Width=size;image.Height=size;image.Stretch=Stretch.UniformToFill;
        var layers=new Grid();layers.Children.Add(Mark(Initial(name),"#DCD4E3",size));layers.Children.Add(image);return new Border{Width=size,Height=size,CornerRadius=new CornerRadius(size*.3),ClipToBounds=true,Child=layers};
    }
    Button BtnFace(string name,Action action){var b=Btn("",action);b.Content=Face(name,36);b.Padding=default;b.Background=Brushes.Transparent;return b;}
    static Button Link(string text,Action action){var b=Btn(text,action);b.Background=Brushes.Transparent;b.Padding=default;b.FontWeight=FontWeight.SemiBold;b.HorizontalContentAlignment=HorizontalAlignment.Left;return b;}
    static Button Btn(string text,Action action,bool primary=false){var b=new Button{Content=text,FontSize=12,Padding=new Thickness(12,8),CornerRadius=new CornerRadius(10),Background=Brush(primary?"#7D6B8C":"#F0EBE5"),Foreground=Brush(primary?"#FFFFFF":Ink),BorderThickness=new Thickness(0),VerticalAlignment=VerticalAlignment.Center};b.Click+=(_,_)=>action();return b;}
    static Control Section(string title,string sub="",Action? action=null,string more="すべて見る →"){var g=new Grid{ColumnDefinitions=new ColumnDefinitions("*,Auto")};g.Children.Add(Row(Text(title,17,weight:FontWeight.SemiBold),Text(sub,11,Muted)));if(action!=null){var b=Btn(more,action);Grid.SetColumn(b,1);g.Children.Add(b);}return g;}
    static Control Empty(string title,string explanation)=>Card(Col(8,Text(title,14,Muted,FontWeight.SemiBold),Text(explanation,12,Muted)),"#F7F3EE");
}

/// <summary>Small retained native drawing, matching the web cards' room previews.</summary>
internal sealed class HomeRoomPreview(string world,int people):Control
{
    public override void Render(DrawingContext c)
    {
        base.Render(c);var w=Bounds.Width;var h=Bounds.Height;var bg=world=="cafe"?"#E7DDCA":world=="game"?"#DCD3E8":"#DCE4EC";
        c.FillRectangle(new SolidColorBrush(Color.Parse(bg)),new Rect(0,0,w,h));
        Point P(double x,double y)=>new(w*.5+(x-y)*w*.28,h*.48+(x+y)*h*.20);
        void Polygon(string color,params Point[] pts){var geo=new StreamGeometry();using(var ctx=geo.Open()){ctx.BeginFigure(pts[0],true);foreach(var p in pts.Skip(1))ctx.LineTo(p);ctx.EndFigure(true);}c.DrawGeometry(new SolidColorBrush(Color.Parse(color)),null,geo);}
        Polygon(world=="cafe"?"#D4B993":"#BDC4CD",P(-1,-1),P(1,-1),P(1,1),P(-1,1));
        Polygon("#FAF6EE",P(-1,-1),new Point(P(-1,-1).X,P(-1,-1).Y-h*.35),new Point(P(1,-1).X,P(1,-1).Y-h*.35),P(1,-1));
        Polygon("#EFE8DC",P(-1,-1),P(-1,1),new Point(P(-1,1).X,P(-1,1).Y-h*.35),new Point(P(-1,-1).X,P(-1,-1).Y-h*.35));
        if(world=="cafe"){foreach(var(x,y)in new[]{(-.5,.25),(.4,.3),(.5,-.5)}){var p=P(x,y);c.DrawEllipse(new SolidColorBrush(Color.Parse("#AC835E")),null,p,13,5);c.DrawLine(new Pen(new SolidColorBrush(Color.Parse("#7B6250")),3),p,new Point(p.X,p.Y+12));}}
        if(world=="game"){for(var i=0;i<4;i++){var p=P(.15+i*.2,-.4+i*.1);c.FillRectangle(new SolidColorBrush(Color.Parse("#9C87B2")),new Rect(p.X,p.Y-i*8,22,7));}}
        for(var i=0;i<Math.Min(people,6);i++){var p=P(-.5+(i%3)*.45,.5-(i/3)*.65);var color=new SolidColorBrush(Color.Parse(new[]{"#B793C7","#D6A271","#83A68F","#819DB4","#C18495","#AAA279"}[i]));c.DrawEllipse(new SolidColorBrush(Color.Parse("#20000000")),null,new Point(p.X,p.Y+4),8,3);c.DrawLine(new Pen(color,8),new Point(p.X,p.Y),new Point(p.X,p.Y-10));c.DrawEllipse(color,null,new Point(p.X,p.Y-16),5,5);}
    }
}
