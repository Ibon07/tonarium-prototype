using System.Diagnostics;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed class ItemWindow : Window
{
    private readonly NativeContext context;
    private readonly string itemId;
    private readonly StackPanel body = Column();
    private readonly TextBlock status = Text("", 13, "#867C8C");
    private readonly List<Action<JsonObject>> refreshers = [];
    private readonly DispatcherTimer tick;
    private string kind = "";
    private bool applying;
    private TextBox? note;
    private DispatcherTimer? noteTimer;
    private NativeVideoView? video;
    private NativeYoutubeView? youtube;
    private JsonObject? Item => context.Client.State.Items[itemId] as JsonObject;

    public ItemWindow(NativeContext context, string itemId)
    {
        this.context = context;
        this.itemId = itemId;
        Width = 650; Height = 600; MinWidth = 390; MinHeight = 300;
        Background = Brush("#F8F5FA");
        FontFamily = new FontFamily("Yu Gothic UI, Segoe UI");
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var root = new DockPanel { Margin = new Thickness(20) };
        var footer = Row(status);
        var remove = Button("片付ける", () => { _ = context.Client.SendRoomAsync(new { t = "itemRemove", id = itemId }); Close(); });
        remove.HorizontalAlignment = HorizontalAlignment.Right;
        var foot = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(0, 14, 0, 0) };
        foot.Children.Add(footer); Grid.SetColumn(remove, 1); foot.Children.Add(remove);
        DockPanel.SetDock(foot, Dock.Bottom); root.Children.Add(foot);
        root.Children.Add(new ScrollViewer { Content = body, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
        Content = root;
        tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(90) };
        tick.Tick += (_, _) => Refresh();
        context.Client.State.Changed += Refresh;
        Closed += (_, _) => { context.Client.State.Changed -= Refresh; tick.Stop(); noteTimer?.Stop(); if (note is not null) { FlushNote(); Send(new { a = "noteLock", @lock = false }); } video?.Dispose(); youtube?.Dispose(); };
        Refresh();
    }

    public void Refresh()
    {
        var item = Item;
        if (item is null) { status.Text = "このアイテムは片付けられました"; body.IsEnabled = false; return; }
        var nextKind = Str(item, "kind");
        if (kind != nextKind) { kind = nextKind; Build(item); }
        applying = true;
        try
        {
            foreach (var refresh in refreshers) refresh(item);
            var animating = kind == "dice" && item["roll"] is JsonObject roll && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + context.Client.State.ServerOffset - Num(roll, "at") < 1800
                || (kind is "video" or "youtube") && Bool(item["clock"], "playing");
            if (animating && !tick.IsEnabled) tick.Start(); else if (!animating && tick.IsEnabled) tick.Stop();
        }
        finally { applying = false; }
    }

    private void Build(JsonObject item)
    {
        refreshers.Clear(); body.Children.Clear();
        var info = ItemCatalog.Get(kind); Title = info.Name + " · tonarium";
        body.Children.Add(Text(info.Mark + "  " + info.Name, 25, info.Ink, true));
        body.Children.Add(Text(info.Description, 13, "#8B8190"));
        switch (kind)
        {
            case "note": BuildNote(); break;
            case "canvas": BuildCanvas(); break;
            case "dice": BuildDice(); break;
            case "chess": case "chessAi": BuildChess(); break;
            case "g2048": Build2048(); break;
            case "hammer": BuildHandheld(false); break;
            case "camera": BuildHandheld(true); break;
            case "image": BuildImage(item); break;
            case "video": BuildVideo(item); break;
            case "youtube": BuildYoutube(item); break;
        }
    }

    private void BuildNote()
    {
        Width = 510; Height = 465;
        note = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 200, MaxLength = 300, FontSize = 20, Padding = new Thickness(16), BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(12) };
        var count = Text("0 / 300", 12);
        noteTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(240) };
        noteTimer.Tick += (_, _) => { noteTimer.Stop(); FlushNote(); };
        note.TextChanged += (_, _) => { count.Text = $"{note.Text?.Length ?? 0} / 300"; if (!applying) { noteTimer.Stop(); noteTimer.Start(); } };
        note.GotFocus += (_, _) => Send(new { a = "noteLock", @lock = true });
        note.LostFocus += (_, _) => { FlushNote(); Send(new { a = "noteLock", @lock = false }); };
        body.Children.Add(note); body.Children.Add(count);
        var colors = Row();
        foreach (var color in new[] { "#fde68a", "#fca5a5", "#86efac", "#93c5fd", "#d8b4fe" })
        {
            var b = Button("", () => Send(new { a = "noteEdit", color })); b.Width = 36; b.Height = 28; b.Background = Brush(color); colors.Children.Add(b);
        }
        body.Children.Add(colors);
        refreshers.Add(it =>
        {
            if (!note.IsKeyboardFocusWithin && !noteTimer.IsEnabled && note.Text != Str(it, "text")) note.Text = Str(it, "text");
            note.Background = Brush(Str(it, "color", "#fde68a"));
            var editor = Str(it, "editingBy"); status.Text = editor.Length > 0 && editor != context.Client.State.SelfId ? UserName(editor) + " が編集中" : "入力は自動保存されます";
        });
    }

    private void FlushNote()
    {
        if (note is null || Item is not { } it || Str(it, "text") == (note.Text ?? "")) return;
        Send(new { a = "noteEdit", text = note.Text ?? "" });
    }

    private void BuildCanvas()
    {
        Width = 720; Height = 780;
        var canvas = new SharedDrawingCanvas(() => Item, Send);
        var toolbar = Row();
        foreach (var color in new[] { "#262331", "#dc5967", "#5d83d4", "#63a883", "#edb44f", "#ab79c9" })
        {
            var c = color; var b = Button("●", () => { canvas.PenColor = c; status.Text = "ペン"; }); b.Foreground = Brush(c); toolbar.Children.Add(b);
        }
        toolbar.Children.Add(Button("細", () => canvas.PenSize = 3));
        toolbar.Children.Add(Button("太", () => canvas.PenSize = 10));
        toolbar.Children.Add(Button("消しゴム", () => { canvas.PenColor = "erase"; canvas.PenSize = 24; status.Text = "消しゴム"; }));
        var confirmClear = false;
        var clear = Button("全部消す", () => { if (!confirmClear) { confirmClear = true; status.Text = "もう一度「全部消す」で確定"; return; } Send(new { a = "canvasClear" }); canvas.ClearPreview(); confirmClear = false; });
        body.Children.Add(toolbar);
        body.Children.Add(new Border { MaxWidth = 620, HorizontalAlignment = HorizontalAlignment.Center, Background = Brushes.White, CornerRadius = new CornerRadius(8), ClipToBounds = true, Child = new Viewbox { Stretch = Stretch.Uniform, Child = canvas } });
        body.Children.Add(Row(clear, Button("画像としてログに保存", () => SaveCanvas(canvas))));
        string last = "";
        refreshers.Add(it => { var data = it["strokes"]?.ToJsonString() ?? "[]"; if (data == last) return; last = data; canvas.InvalidateVisual(); status.Text = $"{Arr(it, "strokes").Count} ストローク · みんなで共有中"; });
    }

    private void SaveCanvas(Control canvas)
    {
        try
        {
            using var bitmap = new RenderTargetBitmap(new PixelSize(620, 450), new Vector(96, 96));
            bitmap.Render(canvas);
            using var stream = new MemoryStream(); bitmap.Save(stream);
            _ = context.Client.SendRoomAsync(new { t = "chat", text = "キャンバスを保存しました", image = "data:image/png;base64," + Convert.ToBase64String(stream.ToArray()), scope = "all" });
            status.Text = "ログに保存しました";
        }
        catch (Exception error) { context.Notify("キャンバスを保存できませんでした: " + error.Message); }
    }

    private void BuildDice()
    {
        Width = 610; Height = 430;
        var tray = new WrapPanel { Orientation = Orientation.Horizontal, MinHeight = 88 };
        var result = Text("種類と個数を選んで振ってください", 16);
        int sides = 6, count = 1; string hiddenRoll = "";
        var sideButtons = new List<Button>(); var options = Row();
        var secret = new CheckBox { Content = "シークレット", Foreground = Brush("#655A70") };
        var number = Text("1個", 16, "#655A70", true);
        var roll = Button("振る", () => { hiddenRoll = ""; Send(new { a = "diceRoll", sides, count, secret = secret.IsChecked == true }); });
        foreach (var n in new[] { 4, 6, 8, 10, 12, 20, 100 })
        {
            var b = Button("d" + n, () => { sides = n; UpdateChoice(); }); sideButtons.Add(b); options.Children.Add(b);
        }
        void UpdateChoice() { for (int i = 0; i < sideButtons.Count; i++) sideButtons[i].Background = Brush(new[] { 4, 6, 8, 10, 12, 20, 100 }[i] == sides ? "#D8C8EA" : "#EEE7F2"); number.Text = count + "個"; roll.Content = $"{count}d{sides} を振る"; }
        body.Children.Add(tray); body.Children.Add(result); body.Children.Add(options);
        body.Children.Add(Row(Button("−", () => { count = Math.Max(1, count - 1); UpdateChoice(); }), number, Button("＋", () => { count = Math.Min(10, count + 1); UpdateChoice(); }), secret, roll));
        body.Children.Add(Button("手元の表示をクリア", () => { hiddenRoll = Str(Item?["roll"], "id"); tray.Children.Clear(); result.Text = "次のロールを待っています"; }));
        UpdateChoice();
        string displayKey = "";
        refreshers.Add(it =>
        {
            if (it["roll"] is not JsonObject r || Str(r, "id") == hiddenRoll) return;
            var elapsed = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + context.Client.State.ServerOffset - Num(r, "at"); var rolling = elapsed < 1800;
            var values = r["results"] as JsonArray;
            if (values is null && Str(r, "by") == context.Client.State.SelfId)
                values = context.Client.State.Chats.OfType<JsonObject>().LastOrDefault(m => Str(m["dice"], "id") == Str(r, "id"))?["dice"]?["results"] as JsonArray;
            roll.IsEnabled = !rolling;
            var key = r.ToJsonString() + ":" + (rolling ? Math.Floor(elapsed / 85) : -1) + ":" + values?.ToJsonString();
            if (key == displayKey) return; displayKey = key; tray.Children.Clear();
            var n = (int)Num(r, "count", 1); var d = (int)Num(r, "sides", 6);
            for (var i = 0; i < n; i++)
            {
                var val = rolling ? (1 + ((int)Math.Max(0, elapsed / 85) * 7919 + i * 104729) % d).ToString() : values?[i]?.ToString() ?? "？";
                tray.Children.Add(new Border { Child = Text(val, 30, "#6F4731", true), Background = Brush("#F3E6D3"), Padding = new Thickness(16, 10), CornerRadius = new CornerRadius(12), Margin = new Thickness(0, 0, 7, 7) });
            }
            result.Text = rolling ? UserName(Str(r, "by")) + " が振っています…" : values is not null ? $"{n}d{d} → {string.Join(" + ", values.Select(v => v?.ToString()))} = {values.Sum(v => Num(v))}" + (Bool(r, "secret") ? "（あなただけ）" : "") : UserName(Str(r, "by")) + " がシークレットで振りました";
            status.Text = "結果はログにも残ります";
        });
    }

    private void Build2048()
    {
        Width = 540; Height = 735;
        var score = Text("スコア 0", 22, "#775C43", true);
        var grid = new Grid { RowDefinitions = new RowDefinitions("*,*,*,*"), ColumnDefinitions = new ColumnDefinitions("*,*,*,*"), Width = 430, Height = 430, Background = Brush("#BEAF9F") };
        var cells = new Border[16]; var values = new TextBlock[16];
        for (int i = 0; i < 16; i++) { values[i] = Text("", 32, "#776E65", true); values[i].HorizontalAlignment = HorizontalAlignment.Center; values[i].VerticalAlignment = VerticalAlignment.Center; cells[i] = new Border { Child = values[i], Margin = new Thickness(5), CornerRadius = new CornerRadius(7) }; Grid.SetRow(cells[i], i / 4); Grid.SetColumn(cells[i], i % 4); grid.Children.Add(cells[i]); }
        void Slide(string dir) => Send(new { a = "slide", dir });
        body.Children.Add(Row(score, Button("新しく始める", () => Send(new { a = "reset2048" })))); body.Children.Add(grid);
        body.Children.Add(Row(Button("←", () => Slide("left")), Button("↑", () => Slide("up")), Button("↓", () => Slide("down")), Button("→", () => Slide("right"))));
        KeyDown += (_, e) => { var dir = e.Key switch { Key.Left or Key.A => "left", Key.Right or Key.D => "right", Key.Up or Key.W => "up", Key.Down or Key.S => "down", _ => null }; if (dir is null) return; Slide(dir); e.Handled = true; };
        refreshers.Add(it => { var data = Arr(it, "grid"); for (int i = 0; i < 16; i++) { int val = i < data.Count ? (int)Num(data[i]) : 0; values[i].Text = val > 0 ? val.ToString() : ""; values[i].Foreground = Brush(val > 4 ? "#FFF8EF" : "#776E65"); values[i].FontSize = val >= 1024 ? 25 : 32; cells[i].Background = Brush(val switch { 0 => "#CDC1B4", 2 => "#EEE4DA", 4 => "#EDE0C8", 8 => "#F2B179", 16 => "#F59563", 32 => "#F67C5F", 64 => "#F65E3B", _ => "#EDC750" }); } score.Text = "スコア " + Num(it, "score"); status.Text = Bool(it, "over") ? "ゲームオーバー · 新しく始められます" : "矢印キー / WASD / ボタンで操作"; });
    }

    private void BuildChess()
    {
        Width = 565; Height = 760;
        var heading = Text("白の手番", 20, "#5E506C", true);
        var grid = new Grid { Width = 480, Height = 480, RowDefinitions = new RowDefinitions("*,*,*,*,*,*,*,*"), ColumnDefinitions = new ColumnDefinitions("*,*,*,*,*,*,*,*") };
        var buttons = new Button[64]; var movesLabel = Text("棋譜はここに表示されます", 13);
        var promotions = Row(); promotions.IsVisible = false;
        int selected = -1, revision = -1, promotionTo = -1; bool resetConfirm = false; string lastRender = "";
        var legal = new List<NativeChess.Move>();
        void Move(int to, string? promotion = null) { Send(new { a = "chessMove", from = selected, to, revision, promotion }); selected = -1; promotionTo = -1; legal.Clear(); promotions.IsVisible = false; lastRender = ""; }
        void Choose(int index)
        {
            if (Item is not { } it || it["chess"] is not JsonObject chess) return;
            var position = new NativeChess(Str(chess, "fen"));
            if (position.IsOver(Arr(chess, "positions")) || (kind == "chessAi" && position.Turn == 'b')) return;
            if (index == selected) { selected = -1; legal.Clear(); }
            else if (position.Board[index]?.StartsWith(position.Turn.ToString(), StringComparison.Ordinal) == true) { selected = index; revision = (int)Num(chess, "revision"); legal = position.LegalMoves(index); }
            else if (legal.Any(m => m.To == index)) { if (legal.Any(m => m.To == index && m.Promotion is not null)) { promotionTo = index; promotions.IsVisible = true; return; } Move(index); }
            lastRender = ""; Refresh();
        }
        for (int i = 0; i < 64; i++) { var index = i; var b = Button("", () => Choose(index)); b.Padding = new Thickness(0); b.Margin = new Thickness(0); b.HorizontalAlignment = HorizontalAlignment.Stretch; b.VerticalAlignment = VerticalAlignment.Stretch; b.CornerRadius = new CornerRadius(0); b.FontSize = 40; b.FontFamily = new FontFamily("Segoe UI Symbol"); Grid.SetRow(b, i / 8); Grid.SetColumn(b, i % 8); grid.Children.Add(b); buttons[i] = b; }
        foreach (var pair in new[] { ("q", "♛ クイーン"), ("r", "♜ ルーク"), ("b", "♝ ビショップ"), ("n", "♞ ナイト") }) promotions.Children.Add(Button(pair.Item2, () => Move(promotionTo, pair.Item1)));
        var reset = Button("新しい対局", () => { if (!resetConfirm) { resetConfirm = true; status.Text = "もう一度「新しい対局」で初期化"; return; } resetConfirm = false; selected = -1; Send(new { a = "chessReset" }); });
        body.Children.Add(Row(heading, reset)); body.Children.Add(grid); body.Children.Add(promotions); body.Children.Add(movesLabel);
        refreshers.Add(it =>
        {
            if (it["chess"] is not JsonObject chess) return;
            int nowRevision = (int)Num(chess, "revision");
            if (revision != nowRevision) { revision = nowRevision; selected = -1; legal.Clear(); promotions.IsVisible = false; }
            var key = chess.ToJsonString() + ":" + selected; if (key == lastRender) return; lastRender = key;
            var pos = new NativeChess(Str(chess, "fen")); var check = pos.InCheck(pos.Turn); var over = pos.IsOver(Arr(chess, "positions"));
            heading.Text = over ? pos.AllLegal().Count == 0 && check ? (pos.Turn == 'w' ? "黒" : "白") + "の勝ち" : "引き分け" : kind == "chessAi" && pos.Turn == 'b' ? "AIが考えています…" : (pos.Turn == 'w' ? "白" : "黒") + "の手番" + (check ? " · チェック！" : "");
            var last = Arr(it, "last").Select(v => (int)Num(v)).ToArray();
            for (int i = 0; i < 64; i++)
            {
                var p = pos.Board[i]; var light = (i / 8 + i % 8) % 2 == 0;
                buttons[i].Background = Brush(selected == i ? "#9FBACC" : check && p == pos.Turn + "K" ? "#E39991" : last.Contains(i) ? "#CDD08B" : light ? "#F0D9B5" : "#B58863");
                buttons[i].Foreground = Brush(p?.StartsWith('w') == true ? "#FFFDF4" : "#2D2630");
                buttons[i].Content = p is null ? legal.Any(m => m.To == i) ? "·" : "" : new ChessPiece(p);
                buttons[i].BorderThickness = legal.Any(m => m.To == i) ? new Thickness(3) : new Thickness(0);
                buttons[i].BorderBrush = Brush("#75948A");
                ToolTip.SetTip(buttons[i], NativeChess.SquareName(i));
            }
            var moves = Arr(chess, "moves"); var pairs = new List<string>(); for (var n = Math.Max(0, moves.Count - 10) / 2 * 2; n < moves.Count; n += 2) pairs.Add($"{n / 2 + 1}. {moves[n]}  {(n + 1 < moves.Count ? moves[n + 1] : "")}");
            movesLabel.Text = pairs.Count > 0 ? string.Join("   ", pairs) : "棋譜はここに表示されます";
            status.Text = over ? "対局終了 · 新しい対局を始められます" : selected >= 0 ? "印のあるマスへ移動" : "駒を選択 → 移動先をクリック";
        });
    }

    private void BuildHandheld(bool camera)
    {
        var held = Text("", 18); var hold = Button("手に持つ", () => { if (Item is not { } it) return; if (Str(it, "holder") == context.Client.State.SelfId) Send(new { a = "drop", x = Num(it, "x"), z = Num(it, "z"), ry = Num(it, "ry"), pitch = Num(it, "pitch") }); else Send(new { a = "pick" }); });
        body.Children.Add(held); body.Children.Add(hold);
        if (camera)
        {
            body.Children.Add(context.Media.CreateVideoView(itemId));
            body.Children.Add(Text("3Dでカメラを持って撮影・ライブ配信できます。", 14));
        }
        else
        {
            body.Children.Add(Text("持った状態で相手を選ぶと、そばへ移動して叩きます。", 14));
            var people = Column(); body.Children.Add(people); string previous = "";
            refreshers.Add(itemState => { var ids = string.Join(",", context.Client.State.Users.Select(u => Str(u, "id") + ":" + Str(u, "session"))); if (previous == ids) return; previous = ids; people.Children.Clear(); foreach (var user in context.Client.State.Users.OfType<JsonObject>().Where(u => Str(u, "id") != context.Client.State.SelfId && Str(u, "session") == context.Client.State.SessionId)) { var id = Str(user, "id"); people.Children.Add(Button("槌  " + Str(user, "name"), () => { if (Str(Item, "holder") != context.Client.State.SelfId) { context.Notify("先にハンマーを手に持ってください"); return; } _ = context.Client.SendRoomAsync(new { t = "hit", to = id }); })); } });
        }
        refreshers.Add(it => { var holder = Str(it, "holder"); held.Text = holder.Length == 0 ? "床に置いてあります" : UserName(holder) + " が持っています"; hold.Content = holder == context.Client.State.SelfId ? "床に置く" : "手に持つ"; hold.IsEnabled = holder.Length == 0 || holder == context.Client.State.SelfId; status.Text = camera ? Bool(it, "live") ? "ライブ配信中" : "配信していません" : "ピコッ"; });
    }

    private void BuildImage(JsonObject item)
    {
        var image = new Image { Stretch = Stretch.Uniform, MaxHeight = 650, MinHeight = 160 };
        body.Children.Add(image); var url = MediaUrl(Str(item, "url"));
        body.Children.Add(Button("ブラウザで開く", () => OpenUrl(url)));
        _ = LoadImage();
        async Task LoadImage() { try { using var http = new HttpClient(); var bytes = await http.GetByteArrayAsync(url); using var stream = new MemoryStream(bytes); var bitmap = new Bitmap(stream); await Dispatcher.UIThread.InvokeAsync(() => { image.Source = bitmap; status.Text = $"{(int)Num(item, "w")} × {(int)Num(item, "h")}"; }); } catch (Exception error) { await Dispatcher.UIThread.InvokeAsync(() => status.Text = "画像を読み込めませんでした: " + error.Message); } }
    }

    private void BuildVideo(JsonObject item)
    {
        Width = 760; Height = 600;
        video = new NativeVideoView(MediaUrl(Str(item, "url")), action => Send(action)); body.Children.Add(video);
        refreshers.Add(it => video.UpdateClock(it["clock"] as JsonObject, context.Client.State.ServerOffset));
        status.Text = "再生・一時停止・シークは全員に反映されます";
    }

    private void BuildYoutube(JsonObject item)
    {
        Width = 780; Height = 650;
        var id = Str(item, "videoId"); var label = Text(Str(item, "title", "YouTube"), 20, "#B3261E", true); body.Children.Add(label);
        youtube = new NativeYoutubeView(id, Send, message => status.Text = message);
        body.Children.Add(youtube);
        var clock = Text("停止中", 18); body.Children.Add(clock);
        var pos = new TextBox { PlaceholderText = "秒", Text = "0", Width = 95 };
        double Position() => double.TryParse(pos.Text, out var p) ? Math.Max(0, p) : 0;
        body.Children.Add(Row(Button("YouTubeで開く", () => OpenUrl("https://www.youtube.com/watch?v=" + Uri.EscapeDataString(id) + "&t=" + (int)Position())), pos, Button("ここから再生", () => Send(new { a = "mediaPlay", pos = Position() })), Button("一時停止", () => Send(new { a = "mediaPause", pos = Position() }))));
        body.Children.Add(Text("プレーヤーで操作すると、再生位置がみんなに共有されます。", 13));
        refreshers.Add(it => { var c = it["clock"]; youtube.UpdateClock(c as JsonObject, context.Client.State.ServerOffset); var p = ClockPosition(c, context.Client.State.ServerOffset); clock.Text = (Bool(c, "playing") ? "▶ 再生中" : "Ⅱ 停止中") + "  " + TimeSpan.FromSeconds(p).ToString(@"hh\:mm\:ss"); if (!pos.IsKeyboardFocusWithin) pos.Text = ((int)p).ToString(); });
    }

    private void Send(object action) => _ = context.Client.SendRoomAsync(new { t = "itemAction", id = itemId, action });
    private string MediaUrl(string url) => new Uri(new Uri(context.Client.State.ServerUrl.TrimEnd('/') + "/"), url).ToString();
    private string UserName(string id) => context.Client.State.Users.OfType<JsonObject>().FirstOrDefault(u => Str(u, "id") == id) is { } user ? Str(user, "name") : id;
    private void OpenUrl(string url) { try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception ex) { context.Notify(ex.Message); } }
    internal static string Str(JsonNode? node, string key, string fallback = "") => node?[key]?.ToString() ?? fallback;
    internal static double Num(JsonNode? node, string key, double fallback = 0) => Num(node?[key], fallback);
    internal static double Num(JsonNode? node, double fallback = 0) => double.TryParse(node?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : fallback;
    internal static bool Bool(JsonNode? node, string key) => bool.TryParse(node?[key]?.ToString(), out var b) && b;
    internal static JsonArray Arr(JsonNode? node, string key) => node?[key] as JsonArray ?? [];
    internal static double ClockPosition(JsonNode? c, long offset = 0) => Math.Max(0, Num(c, "base") + (Bool(c, "playing") ? Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + offset - Num(c, "at")) / 1000 : 0));
    internal static IBrush Brush(string color) => new SolidColorBrush(Color.Parse(color));
    internal static TextBlock Text(string text, double size = 14, string color = "#56465E", bool bold = false) => new() { Text = text, FontSize = size, Foreground = Brush(color), FontWeight = bold ? FontWeight.SemiBold : FontWeight.Normal, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
    internal static StackPanel Row(params Control[] controls) { var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center }; foreach (var c in controls) panel.Children.Add(c); return panel; }
    internal static StackPanel Column(params Control[] controls) { var panel = new StackPanel { Spacing = 12 }; foreach (var c in controls) panel.Children.Add(c); return panel; }
    internal static Button Button(string label, Action click) { var b = new Button { Content = label, Padding = new Thickness(12, 8), CornerRadius = new CornerRadius(8), Background = Brush("#ECE4F1"), Foreground = Brush("#62536D"), BorderThickness = new Thickness(0) }; b.Click += (_, _) => click(); return b; }
}

internal sealed class ChessPiece(string piece) : Control
{
    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var white = piece.StartsWith('w');
        // Solid chess glyphs plus a narrow outline keep both sides readable on pale squares.
        var symbol = NativeChess.Glyph("b" + piece[1]);
        var face = new Typeface(new FontFamily("Segoe UI Symbol"));
        var outline = new FormattedText(symbol, System.Globalization.CultureInfo.CurrentCulture, FlowDirection.LeftToRight, face, 43, white ? ItemWindow.Brush("#554B4D") : Brushes.White);
        var fill = new FormattedText(symbol, System.Globalization.CultureInfo.CurrentCulture, FlowDirection.LeftToRight, face, 43, white ? Brushes.White : ItemWindow.Brush("#342A31"));
        var point = new Point((Bounds.Width - fill.Width) / 2, (Bounds.Height - fill.Height) / 2);
        foreach (var delta in new[] { new Vector(-1, 0), new Vector(1, 0), new Vector(0, -1), new Vector(0, 1) }) context.DrawText(outline, point + delta);
        context.DrawText(fill, point);
    }
    protected override Size MeasureOverride(Size availableSize) => new(50, 50);
}
