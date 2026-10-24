using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Templates;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed class SurvivorPanel : UserControl
{
    internal static readonly JsonObject Catalog = JsonNode.Parse(typeof(SurvivorPanel).Assembly.GetManifestResourceStream("Tonarium.SurvivorCatalog.json")!)!.AsObject();
    internal static JsonNode Constants => Catalog["constants"]!;
    internal static double JoinX => J.Number(Constants["join"], "x");
    internal static double JoinZ => J.Number(Constants["join"], "z");
    internal static double JoinRadius => J.Number(Constants["join"], "r");
    internal static double RoomHalf => J.Number(Constants, "roomHalf");
    private readonly NativeContext ctx;
    private readonly TextBlock status = Text(""), vitals = Text(""), bossHealth = Text("");
    private readonly ProgressBar hp = Bar("#e45169"), xp = Bar("#e9c75b"), bossHp = Bar("#ff315d");
    private readonly StackPanel pauseBanner = new() { Spacing = 4 };
    private readonly DispatcherTimer animation = new() { Interval = TimeSpan.FromMilliseconds(33) };
    private static TextBlock Text(string value, double size = 12) => Ui.Text(value, size, "#f5eaf1");
    private static ProgressBar Bar(string color) => new() { Minimum = 0, Maximum = 1, Height = 6, Foreground = Brush.Parse(color), Background = Brush.Parse("#3b303f") };
    private readonly StackPanel primaryActions = new() { Spacing = 8 }, actions = new() { Spacing = 8 };
    private readonly SurvivorMap map;
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly HashSet<Key> keys = [];
    private string signature = "";
    private Window? libraryWindow;
    private double x, z;
    private bool sending, confirmReset, movementActive;
    private int run = -1;
    private string session = "";
    private JsonObject State => ctx.State.Survivor;
    private JsonObject? Me => State["players"]?[ctx.State.SelfId] as JsonObject;
    internal static string Name(string group, string id) => J.Text(Catalog[group]?[id], "name", id);
    internal static (double X, double Z) PositionOf(ClientState state, JsonNode user)
    {
        var id = J.Text(user, "id");
        var position = J.Text(user, "mode") == "3d" ? state.Avatars[id] : state.Presence[id]?["pos"] ?? user["pos"];
        return (J.Number(position, "x"), J.Number(position, "z", JoinZ));
    }
    public SurvivorPanel(NativeContext context)
    {
        ctx = context;
        Focusable = true;
        map = new SurvivorMap(ctx.State) { Height = 320, MaxWidth = 320, HorizontalAlignment = HorizontalAlignment.Stretch, Focusable = true };
        map.PointerPressed += (_, _) => Focus();
        pauseBanner.Children.Add(Text("✦ 時が止まった ✦", 16));
        pauseBanner.Children.Add(Text("装備を選ぶまで、敵も時間も一時停止中", 10));
        var box = new StackPanel { Spacing = 10, Margin = new Thickness(12) };
        box.Children.Add(Text(J.Text(Catalog, "title"), 14));
        box.Children.Add(status); box.Children.Add(pauseBanner); box.Children.Add(map);
        box.Children.Add(bossHealth); box.Children.Add(bossHp);
        box.Children.Add(Text("✦ 仲間と自分　◆ 夜の眷属\n攻撃は自動 · 光る軌跡が攻撃 · WASD / 矢印で移動", 10));
        box.Children.Add(vitals); box.Children.Add(hp); box.Children.Add(xp);
        box.Children.Add(primaryActions); box.Children.Add(actions);
        Content = new Border { Background = Brush.Parse("#1b1520"), BorderBrush = Brush.Parse("#65435f"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Child = new ScrollViewer { Content = box, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled } };
        animation.Tick += (_, _) => { if (IsEffectivelyVisible) map.InvalidateVisual(); };
        timer.Tick += async (_, _) => { Refresh(); await Move(); };
        AttachedToVisualTree += (_, _) => { ctx.Owner.Deactivated += Deactivated; ctx.Owner.AddHandler(KeyDownEvent, OnMovementKeyDown, RoutingStrategies.Bubble); ctx.Owner.AddHandler(KeyUpEvent, OnMovementKeyUp, RoutingStrategies.Bubble); timer.Start(); animation.Start(); };
        DetachedFromVisualTree += (_, _) => { timer.Stop(); animation.Stop(); ctx.Owner.Deactivated -= Deactivated; ctx.Owner.RemoveHandler(KeyDownEvent, OnMovementKeyDown); ctx.Owner.RemoveHandler(KeyUpEvent, OnMovementKeyUp); libraryWindow?.Close(); keys.Clear(); };
    }
    private bool TextInputFocused => ctx.Owner.FocusManager?.GetFocusedElement() is Control c && (c is TextBox or Button || c.GetVisualAncestors().Any(a => a is TextBox or Button));
    private void OnMovementKeyDown(object? sender, KeyEventArgs e)
    {
        if (!IsEffectivelyVisible || !movementActive || !MovementKey(e.Key) || TextInputFocused) return;
        keys.Add(e.Key); e.Handled = true;
    }
    private void OnMovementKeyUp(object? sender, KeyEventArgs e) => keys.Remove(e.Key);
    private void Deactivated(object? sender, EventArgs e) => keys.Clear();
    private static bool MovementKey(Key key) => key is Key.W or Key.A or Key.S or Key.D or Key.Up or Key.Down or Key.Left or Key.Right;
    private async Task Send(object message)
    {
        try { await ctx.Client.SendRoomAsync(message); }
        catch (Exception e) { keys.Clear(); ctx.Notify(e.Message); }
    }
    private async Task Move()
    {
        if (TextInputFocused) { keys.Clear(); return; }
        if (sending || !IsEffectivelyVisible || ctx.State.World != "survivors" || ctx.State.Mode != "2d" || TextInputFocused || Me is not { } me || !J.Bool(me, "alive") || State["pausedAt"] != null || J.Text(State, "phase") is not ("running" or "boss")) return;
        var dx = (keys.Contains(Key.D) || keys.Contains(Key.Right) ? 1 : 0) - (keys.Contains(Key.A) || keys.Contains(Key.Left) ? 1 : 0);
        var dz = (keys.Contains(Key.S) || keys.Contains(Key.Down) ? 1 : 0) - (keys.Contains(Key.W) || keys.Contains(Key.Up) ? 1 : 0);
        if (dx == 0 && dz == 0) return;
        double step = J.Number(Constants, "moveSpeed") * (1 + J.Number(ctx.State.SurvivorProfile["upgrades"], "haste") * .03) * (1 + J.Number(me["gear"], "nightcloak") * .025) * .1 / Math.Sqrt(dx * dx + dz * dz);
        x = Math.Clamp(x + dx * step, -J.Number(Constants, "worldLimit"), J.Number(Constants, "worldLimit")); z = Math.Clamp(z + dz * step, -J.Number(Constants, "worldLimit"), J.Number(Constants, "worldLimit"));
        sending = true;
        try { await Send(new { t = "survivorMove", x, z }); } finally { sending = false; }
    }
    public void Refresh()
    {
        if (ctx.State.World != "survivors" || ctx.State.Mode != "2d" || !IsEffectivelyVisible) { keys.Clear(); movementActive = false; libraryWindow?.Close(); return; }
        var me = Me; var phase = J.Text(State, "phase", "lobby"); var active = phase is "running" or "boss";
        var paused = active && State["pausedAt"] != null;
        var nextSession = ctx.State.SessionId ?? "";
        var changedRun = run != J.Number(State, "run") || session != nextSession;
        var canMove = active && !paused && J.Bool(me, "alive");
        if (changedRun || !canMove || canMove != movementActive) keys.Clear();
        if (session != nextSession) { confirmReset = false; signature = ""; }
        movementActive = canMove;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ctx.State.ServerOffset;
        var elapsed = Math.Max(0, (paused ? J.Number(State, "pausedAt") : now) - J.Number(State, "startedAt"));
        var seconds = Math.Max(0, (int)Math.Ceiling((J.Number(Constants, "durationMs") - elapsed) / 1000));
        var statusLabel = paused ? "装備選択中 · 時が止まっています" : active && me != null && !J.Bool(me, "alive") ? "倒れました · 仲間を観戦中" : phase switch { "lobby" => "参加者を待っています", "running" => "夜の眷属が迫る", "boss" => "夜の王が現れた", _ => J.Bool(State, "bossDefeated") ? "夜の王を討伐" : "ラン終了" };
        status.Text = statusLabel + (active ? phase == "boss" ? "　BOSS" : $"　{seconds / 60}:{seconds % 60:00}" : "");
        pauseBanner.IsVisible = paused; map.Opacity = paused ? .76 : 1;
        hp.IsVisible = xp.IsVisible = vitals.IsVisible = me != null;
        hp.Value = me is null ? 0 : Math.Clamp(J.Number(me, "hp") / Math.Max(1, J.Number(me, "maxHp")), 0, 1);
        xp.Value = me is null ? 0 : Math.Clamp(J.Number(me, "xp") / Math.Max(1, J.Number(me, "nextXp")), 0, 1);
        var bosses = J.Array(State, "enemies").Where(e => J.Text(e, "kind") == "boss").ToArray();
        var bossTotal = bosses.Sum(e => J.Number(e, "hp")); var bossMax = bosses.Sum(e => J.Number(e, "maxHp"));
        bossHp.IsVisible = bossHealth.IsVisible = phase == "boss" && bosses.Length > 0;
        bossHealth.Text = $"夜の王 ×{bosses.Length} · {Math.Ceiling(bossTotal):N0} / {bossMax:N0}";
        bossHp.Value = Math.Clamp(bossTotal / Math.Max(1, bossMax), 0, 1);
        vitals.Text = me is null ? "参加エリアに入って開始してください" : $"Lv.{J.Number(me, "level")}　HP {Math.Ceiling(J.Number(me, "hp"))}/{J.Number(me, "maxHp")}　EXP {Math.Floor(J.Number(me, "xp"))}/{J.Number(me, "nextXp")}" + (J.Bool(me, "alive") ? "" : "　倒れました・観戦中") + $"　討伐 {J.Number(me, "kills")}";
        if (keys.Count == 0 || changedRun)
        { x = J.Number(me, "x"); z = J.Number(me, "z"); }
        run = (int)J.Number(State, "run"); session = nextSession;
        map.InvalidateVisual();
        var choice = me?["choiceQueue"]?.AsArray().FirstOrDefault() as JsonArray ?? new();
        var user = ctx.State.Users.FirstOrDefault(u => J.Text(u, "id") == ctx.State.SelfId);
        var position = user is null ? (X: JoinX, Z: JoinZ) : PositionOf(ctx.State, user);
        bool canJoin = user is not null && Math.Sqrt(Math.Pow(position.X - JoinX, 2) + Math.Pow(position.Z - JoinZ, 2)) <= JoinRadius;
        var inJoin = ctx.State.Users.Where(u => J.Text(u, "session") == ctx.State.SessionId).Where(u => { var p = PositionOf(ctx.State, u!); return Math.Sqrt((p.X - JoinX) * (p.X - JoinX) + (p.Z - JoinZ) * (p.Z - JoinZ)) <= JoinRadius; }).ToArray();
        var joinNames = string.Join("、", inJoin.Select(u => J.Text(u, "name")));
        var next = $"{phase}|{J.Bool(me, "alive")}|{me is null}|{canJoin}|{choice.ToJsonString()}|{me?["gear"]}|{string.Join(";", J.Object(State, "players").Select(p => $"{p.Key}:{p.Value?["choiceQueue"]}:{p.Value?["gear"]}"))}|{State["stylePicks"]}|{joinNames}|{ctx.State.SurvivorProfile}|{confirmReset}";
        if (next == signature) return;
        signature = next;
        actions.Children.Clear(); primaryActions.Children.Clear();
        Button Command(string text, object command, bool enabled = true, bool primary = false)
        {
            var b = Ui.Button(text, async () => { await Send(command); Focus(); });
            b.ContentTemplate = new FuncDataTemplate<string>((label, _) =>
            {
                var lines = (label ?? "").Split('\n'); var content = new StackPanel { Spacing = 5 };
                for (var i = 0; i < lines.Length; i++) { var text = Text(lines[i], i == 0 ? 12 : 9); if (i == 0) text.FontWeight = FontWeight.Bold; content.Children.Add(text); }
                return content;
            });
            b.VerticalAlignment = VerticalAlignment.Stretch; b.VerticalContentAlignment = VerticalAlignment.Top; b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            b.Background = Brush.Parse("#302333"); b.Foreground = Brush.Parse("#f7eaf2"); b.BorderBrush = Brush.Parse("#594355"); b.BorderThickness = new Thickness(1);
            b.IsEnabled = enabled; (primary ? primaryActions : actions).Children.Add(b); return b;
        }
        if (J.Bool(me, "alive") && choice.Count > 0)
        {
            primaryActions.Children.Add(Text("✦ LEVEL UP ✦\n新たな力を選ぶ", 16));
            primaryActions.Children.Add(Text("選択中はセッション全体が停止します", 10));
            var cards = new UniformGrid { Columns = 3 }; primaryActions.Children.Add(cards);
            foreach (var gear in choice.Select(v => J.Value(v)))
            {
                var def = Catalog["gear"]?[gear];
                var card = Command($"{Name("gear", gear)}\n{Rarity(J.Text(def, "rarity"))} · Lv.{J.Number(me?["gear"], gear) + 1}\n{J.Text(def, "desc")}{Relations(gear)}", new { t = "survivorChoose", gear }, primary: true);
                primaryActions.Children.Remove(card); cards.Children.Add(card); card.Margin = new Thickness(2); card.Padding = new Thickness(8);
                card.BorderBrush = Brush.Parse(J.Text(def, "rarity") switch { "rare" => "#70c5ff", "epic" => "#c989ff", "mythic" => "#ffc863", _ => "#efcc8e" });
            }
        }
        foreach (var (ownerId, owner) in J.Object(State, "players").Where(p => p.Key != ctx.State.SelfId && J.Bool(p.Value, "alive") && (p.Value?["choiceQueue"] as JsonArray)?.Count > 0))
        {
            primaryActions.Children.Add(Text($"{J.Text(owner, "name")}の装備選択 · 観戦", 14));
            foreach (var option in (owner?["choiceQueue"]?[0] as JsonArray ?? new()))
            {
                var id = J.Value(option); primaryActions.Children.Add(Text($"{Name("gear", id)} · Lv.{J.Number(owner?["gear"], id) + 1}\n{J.Text(Catalog["gear"]?[id], "desc")}{Relations(id)}", 11));
            }
        }
        if (!active || me is null)
        {
            primaryActions.Children.Add(Text(active ? "途中参加" : phase == "ended" ? "次の夜へ" : "スタイルを選ぶ", 14));
            var styles = new UniformGrid { Columns = 3 }; primaryActions.Children.Add(styles);
            foreach (var (id, def) in Catalog["styles"]!.AsObject())
            {
                var selected = J.Text(State["stylePicks"], ctx.State.SelfId, "bloodrose") == id;
                var card = Command($"{J.Text(def, "mark")} {J.Text(def, "name")}\n{J.Text(def, "desc")}\n初期装備: {Name("gear", J.Text(def, "weapon"))} · HP {J.Number(def, "hp")} · 移動 {J.Number(def, "speed"):F1}", new { t = "survivorStyle", style = id }, !active || canJoin, primary: true);
                primaryActions.Children.Remove(card); styles.Children.Add(card); card.Margin = new Thickness(2); card.Padding = new Thickness(8);
                if (selected) { card.BorderBrush = Brush.Parse("#ff9ac8"); card.Background = Brush.Parse("#513046"); }
            }
            primaryActions.Children.Add(Text($"参加エリアに {inJoin.Length} 人 · {joinNames}", 10));
            var start = Command(active ? "レベル1から途中参加" : phase == "ended" ? "もう一度プレイ" : "参加者でゲーム開始", new { t = "survivorStart" }, canJoin && !J.Bool(me, "alive"), primary: true);
            start.Background = Brush.Parse("#2f5fc4"); start.HorizontalContentAlignment = HorizontalAlignment.Center;
            if (!canJoin) primaryActions.Children.Add(Text("参加エリアの輪の中に入ると参加できます", 10));
            if (phase == "ended" && me != null) primaryActions.Children.Add(Text($"今回の獲得ポイント: +{J.Number(me, "level")} pt"));
        }
        if (me?["gear"] is JsonObject gearMap)
        {
            actions.Children.Add(Text("装備: " + string.Join(" / ", gearMap.Where(g => !J.Bool(Catalog["gear"]?[g.Key], "synergyGear") && J.Number(gearMap, g.Key) > 0).Select(g => $"{Name("gear", g.Key)} Lv.{g.Value}")), 12));
            var synergy = gearMap.Where(g => J.Bool(Catalog["gear"]?[g.Key], "synergyGear") && J.Number(gearMap, g.Key) > 0).ToArray();
            actions.Children.Add(Text($"専用シナジー枠 {synergy.Length}/{J.Number(Constants, "maxSynergyGear")}: " + string.Join(" / ", synergy.Select(g => Name("gear", g.Key))), 12));
        }
        var profile = ctx.State.SurvivorProfile;
        actions.Children.Add(Text($"永続強化　{J.Number(profile, "points")} pt", 15));
        foreach (var (id, def) in Catalog["upgrades"]!.AsObject())
        {
            var level = J.Number(profile["upgrades"], id);
            Command($"{J.Text(def, "name")} Lv.{level}/{J.Number(def, "max")}　{J.Text(def, "desc")} ({J.Number(def, "cost")} pt)", new { t = "survivorUpgrade", upgrade = id }, J.Number(profile, "points") >= J.Number(def, "cost") && level < J.Number(def, "max"));
        }
        if (!active && J.Object(profile, "upgrades").Any(u => J.Number(profile["upgrades"], u.Key) > 0))
        {
            var invested = J.Object(profile, "upgrades").Sum(u => J.Number(profile["upgrades"], u.Key) * J.Number(Catalog["upgrades"]?[u.Key], "cost"));
            if (confirmReset) { actions.Children.Add(Text($"すべての永続強化を Lv.0 に戻し、{invested} pt を返却します。")); Command($"リセットして {invested} pt を受け取る", new { t = "survivorReset" }); }
            actions.Children.Add(Ui.Button(confirmReset ? "キャンセル" : "強化をリセット…", () => { confirmReset = !confirmReset; Refresh(); }));
        }
        var library = new StackPanel { Spacing = 6 };
        library.Children.Add(Text($"プレイ {J.Number(profile, "runs")} 回 · 最高 Lv.{J.Number(profile, "bestLevel")} · 最高討伐 {J.Number(profile, "bestKills")}"));
        var mythicFound = J.Array(profile, "discovered").Any(v => J.Text(Catalog["gear"]?[J.Value(v)], "rarity") == "mythic");
        foreach (var (id, def) in Catalog["gear"]!.AsObject().Where(g => J.Text(g.Value, "rarity") != "mythic" || mythicFound)) library.Children.Add(Text($"{(J.Array(profile, "discovered").Any(v => J.Value(v) == id) ? "発見済み" : "未獲得")} {J.Text(def, "name")}：{J.Text(def, "desc")}{Relations(id)}", 12));
        if (!mythicFound) library.Children.Add(Text("？？？ · 未発見\n図鑑に載っていない装備"));
        foreach (var (id, def) in Catalog["achievements"]!.AsObject()) library.Children.Add(Text($"{(J.Array(profile, "achievements").Any(v => J.Value(v) == id) ? "達成" : "未達成")} {J.Text(def, "name")}：{J.Text(def, "desc")}", 12));
        var libraryContent = new ScrollViewer { Content = library, Margin = new Thickness(16) };
        if (libraryWindow != null) libraryWindow.Content = libraryContent;
        actions.Children.Add(Ui.Button("装備図鑑・実績を開く", () =>
        {
            if (libraryWindow != null) { libraryWindow.Activate(); return; }
            libraryWindow = new Window { Title = "装備図鑑・実績", Width = 660, Height = 720, MinWidth = 360, MinHeight = 300, Background = Brush.Parse("#1b1520"), Content = libraryContent, WindowStartupLocation = WindowStartupLocation.CenterOwner };
            libraryWindow.Closed += (_, _) => libraryWindow = null;
            libraryWindow.Show(ctx.Owner);
        }));
    }
    private static string Rarity(string rarity) => rarity switch { "rare" => "希少", "epic" => "英雄", "mythic" => "神話", _ => "一般" };
    private static string Relations(string id)
    {
        var gear = Catalog["gear"]?[id];
        var partner = J.Text(gear, "synergy");
        if (partner.Length == 0) partner = Catalog["gear"]!.AsObject().FirstOrDefault(g => J.Text(g.Value, "synergy") == id).Key;
        return (string.IsNullOrEmpty(partner) ? "" : "\nシナジー: " + Name("gear", partner)) + (gear?["evolvedFrom"] is JsonArray evolved ? "\n進化条件: " + string.Join(" + ", evolved.Select(v => Name("gear", J.Value(v)))) : "") + (J.Bool(gear, "synergyGear") ? $"\n専用シナジー枠 · 最大{J.Number(Constants, "maxSynergyGear")}個" : "");
    }
}
