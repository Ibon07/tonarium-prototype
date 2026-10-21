using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

public sealed partial class RoomView
{
    private readonly Dictionary<string, (ContentControl View, string Key)> _playerRows = new();
    private readonly Control[] _bands = [BandLabel(0), BandLabel(1), BandLabel(2)];
    private readonly Control _noOthers = Empty("まだ誰もいません");
    private readonly Dictionary<string, PortraitTile> _portraitTiles = new();
    // One parent for every layout: moving a tile never detaches its rasterizer.
    private readonly Canvas _portraitCanvas = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private Button? _foldedFaces;
    private string _foldedFacesKey = "";

    private JsonNode? CurrentParticipant(string id) => Participants().FirstOrDefault(u => J.Text(u, "id") == id);

    private void RefreshPlayers(List<JsonNode> users)
    {
        var ids = users.Select(u => J.Text(u, "id")).ToHashSet();
        foreach (var id in _playerRows.Keys.Where(id => !ids.Contains(id)).ToArray())
        { _playerRows.Remove(id); _distanceLabels.Remove(id); }
        var desired = new List<Control>();
        void Add(JsonNode user)
        {
            var id = J.Text(user, "id"); var self = id == _ctx.State.SelfId;
            var key = $"{J.Text(user, "name")}|{J.Text(user, "mode")}|{J.Text(user, "follow")}|{J.Bool(user, "micOn")}|{J.Bool(user, "sharing")}|{J.Text(user, "icon")}|{Band(Distance(user))}|{self}|{_ctx.State.Mode}";
            if (!_playerRows.TryGetValue(id, out var entry)) entry = (new ContentControl(), "");
            if (entry.Key != key)
            {
                _distanceLabels.Remove(id);
                entry.View.Content = PlayerRow(user, self);
                _playerRows[id] = (entry.View, key);
            }
            desired.Add(entry.View);
        }
        if (users.FirstOrDefault(u => J.Text(u, "id") == _ctx.State.SelfId) is { } self) Add(self);
        var others = users.Where(u => J.Text(u, "id") != _ctx.State.SelfId).OrderBy(Distance).ToList();
        for (var band = 0; band < 3; band++)
        {
            var entries = others.Where(u => Band(Distance(u)) == band).ToList();
            if (entries.Count == 0) continue;
            desired.Add(_bands[band]); foreach (var user in entries) Add(user);
        }
        if (others.Count == 0) desired.Add(_noOthers);
        foreach (var child in _players.Children.Where(c => !desired.Contains(c)).ToArray()) _players.Children.Remove(child);
        for (var i = 0; i < desired.Count; i++)
        {
            var index = _players.Children.IndexOf(desired[i]);
            if (index < 0) _players.Children.Insert(i, desired[i]);
            else if (index != i) _players.Children.Move(index, i);
        }
    }

    private void RefreshFaces(List<JsonNode> users)
    {
        if (_foldedFaces is null)
        {
            _foldedFaces = Small("", () => { _facesHidden = false; NativeSettings.SetBool("room.facesFolded", false); Fit(); });
            _foldedFaces.Background = Brush.Parse("#F0FFFDF9"); _foldedFaces.CornerRadius = new CornerRadius(99); _foldedFaces.Padding = new Thickness(6, 4, 10, 4);
            _faces.Children.Add(_portraitCanvas); _faces.Children.Add(_foldedFaces);
        }
        var self = users.FirstOrDefault(u => J.Text(u, "id") == _ctx.State.SelfId);
        var others = users.Where(u => J.Text(u, "id") != _ctx.State.SelfId).OrderBy(Distance).ToList();
        var near = others.Where(u => Distance(u) <= 3).ToList();
        var mid = others.Where(u => Distance(u) > 3 && Distance(u) <= 15).ToList();
        var eligible = new List<JsonNode>(); if (self is not null) eligible.Add(self); eligible.AddRange(near); eligible.AddRange(mid);
        var ids = eligible.Select(u => J.Text(u, "id")).ToHashSet();
        foreach (var id in _portraitTiles.Keys.Where(id => !ids.Contains(id)).ToArray())
        { _portraitCanvas.Children.Remove(_portraitTiles[id].Root); _portraitTiles.Remove(id); }
        foreach (var user in eligible)
        {
            var id = J.Text(user, "id");
            if (!_portraitTiles.TryGetValue(id, out var tile))
            { tile = new PortraitTile(this, id); tile.Root.IsVisible = false; _portraitTiles[id] = tile; _portraitCanvas.Children.Add(tile.Root); }
            tile.Update(user);
        }
        _faceFold.IsVisible = !Gallery && !_facesHidden;
        _foldedFaces.IsVisible = _facesHidden; _portraitCanvas.IsVisible = !_facesHidden;
        if (_facesHidden)
        {
            var key = string.Join("|", near.Take(4).Select(u => $"{J.Text(u, "id")}:{J.Text(u, "name")}:{J.Text(u, "icon")}")) + $"/{near.Count}/{mid.Count}";
            if (key != _foldedFacesKey)
            {
                _foldedFacesKey = key;
                var mini = Ui.Row(); mini.Spacing = 0; foreach (var user in near.Take(4)) mini.Children.Add(Face(user, 24));
                _foldedFaces.Content = Ui.Row(mini, Ui.Text($"すぐそば {near.Count}", 12), Ui.Text($"· 声が届く {mid.Count}", 12, Ui.Muted), new WebIcon("down", 14));
            }
            return;
        }
        var available = Math.Max(120, Bounds.Width - _center.Margin.Left - _center.Margin.Right);
        var shown = new HashSet<string>();
        void Place(JsonNode user, double width, bool small, double x, double y)
        {
            var id = J.Text(user, "id"); shown.Add(id);
            var tile = _portraitTiles[id];
            tile.Layout(width, small, Gallery); Canvas.SetLeft(tile.Root, x); Canvas.SetTop(tile.Root, y); tile.Root.IsVisible = true;
        }
        if (Gallery)
        {
            var size = GalleryTile(eligible.Count, available, Math.Max(120, Bounds.Height - 234));
            var columns = Math.Max(1, Math.Min(Math.Max(1, eligible.Count), (int)((available + 12) / (size + 12))));
            for (var i = 0; i < eligible.Count; i++) Place(eligible[i], size, false, i % columns * (size + 12) + 6, i / columns * (size * .75 + 12) + 6);
            _portraitCanvas.Width = columns * (size + 12); _portraitCanvas.Height = Math.Ceiling(eligible.Count / (double)columns) * (size * .75 + 12);
        }
        else
        {
            var large = new List<JsonNode>(); if (self is not null) large.Add(self); large.AddRange(near.Take(4));
            var width = Math.Clamp((Math.Max(150, available) - (mid.Count > 0 ? 150 : 0) - Math.Max(0, large.Count - 1) * 8) / Math.Max(1, large.Count), 96, 144);
            var x = 0d; foreach (var user in large) { Place(user, width, false, x, 0); x += width + 8; }
            for (var i = 0; i < Math.Min(3, mid.Count); i++) Place(mid[i], 70, true, x + i / 2 * 74, i % 2 * 57);
            MoreFaces.IsVisible = mid.Count > 3;
            if (MoreFaces.IsVisible) { ((TextBlock)MoreFaces.Child!).Text = $"+{mid.Count - 3}"; Canvas.SetLeft(MoreFaces, x + 74); Canvas.SetTop(MoreFaces, 57); }
            _portraitCanvas.Width = Math.Max(0, x - 8) + (mid.Count > 0 ? 156 : 0);
            _portraitCanvas.Height = Math.Max(width * .75, mid.Count > 1 ? 110 : mid.Count > 0 ? 53 : 0);
        }
        if (Gallery) MoreFaces.IsVisible = false;
        foreach (var (id, tile) in _portraitTiles) if (!shown.Contains(id)) tile.Root.IsVisible = false;
    }

    private Border? _moreFaces;
    private Border MoreFaces
    {
        get
        {
            if (_moreFaces is not null) return _moreFaces;
            _moreFaces = new Border { Width = 70, Height = 52, CornerRadius = new CornerRadius(10), Background = Brush.Parse("#BB26262E"), Child = CenterText("", 14), IsVisible = false };
            _portraitCanvas.Children.Add(_moreFaces); return _moreFaces;
        }
    }

    private sealed class PortraitTile
    {
        public Border Root { get; }
        private readonly RoomView room;
        private readonly string id;
        private readonly AvatarPortrait portrait;
        private readonly Button button, profile;
        private readonly Grid body = new();
        private readonly ContentControl fullIcon = new(), smallIcon = new(), microphone = new();
        private readonly TextBlock name = Ui.Text("", 12, "#FFFFFF"), distance = Ui.Text("", 10, "#FFFFFF"), bubbleText = Ui.Text("", 11);
        private readonly Border footer, bubble, badge;
        private string iconKey = "", microphoneKey = "";

        public PortraitTile(RoomView room, string id)
        {
            this.room = room; this.id = id;
            portrait = new AvatarPortrait(room._ctx, id);
            button = Small("", () =>
            {
                if (room._ctx.State.Mode == "2d" && id != room._ctx.State.SelfId && room._ctx.State.Items.Any(p => J.Text(p.Value, "kind") == "hammer" && J.Text(p.Value, "holder") == room._ctx.State.SelfId)) room.PickUser(id);
                else if (room.CurrentParticipant(id) is { } user) room.OpenPortrait(user);
            });
            button.Content = portrait; button.Padding = new Thickness(0); button.ClipToBounds = true; body.Children.Add(button);
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("18,Auto,*,Auto"), ColumnSpacing = 5 };
            row.Children.Add(fullIcon); Grid.SetColumn(microphone, 1); row.Children.Add(microphone);
            name.TextWrapping = TextWrapping.NoWrap; name.TextTrimming = TextTrimming.CharacterEllipsis; name.FontWeight = FontWeight.Bold; Grid.SetColumn(name, 2); row.Children.Add(name);
            Grid.SetColumn(distance, 3); row.Children.Add(distance);
            footer = new Border { Child = row, Background = Brush.Parse("#B826262E"), CornerRadius = new CornerRadius(9), Padding = new Thickness(3, 2, 7, 2), Margin = new Thickness(6), VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false }; body.Children.Add(footer);
            smallIcon.HorizontalAlignment = HorizontalAlignment.Left; smallIcon.VerticalAlignment = VerticalAlignment.Bottom; smallIcon.Margin = new Thickness(4); body.Children.Add(smallIcon);
            profile = IconButton("more", "", () => room._ctx.OpenProfile(id), 14); profile.Background = Brush.Parse("#C7FFFFFF"); profile.Width = profile.Height = 28; profile.HorizontalAlignment = HorizontalAlignment.Right; profile.VerticalAlignment = VerticalAlignment.Top; profile.Margin = new Thickness(5); body.Children.Add(profile);
            bubbleText.TextWrapping = TextWrapping.NoWrap; bubbleText.TextTrimming = TextTrimming.CharacterEllipsis;
            bubble = new Border { Child = bubbleText, Background = Brush.Parse("#F2FFFFFF"), CornerRadius = new CornerRadius(9, 9, 9, 3), Padding = new Thickness(8, 4), Margin = new Thickness(6, 0, 6, 38), VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false }; body.Children.Add(bubble);
            badge = Pill("3D", "#26262E", "#FFFFFF"); badge.HorizontalAlignment = HorizontalAlignment.Left; badge.VerticalAlignment = VerticalAlignment.Top; badge.Margin = new Thickness(6); body.Children.Add(badge);
            Root = new Border { Child = body, Background = Brush.Parse(PortraitColor(id)), ClipToBounds = true };
        }

        public void Update(JsonNode user)
        {
            var self = id == room._ctx.State.SelfId; var speaking = J.Bool(user, "speaking");
            Root.BorderThickness = new Thickness(speaking ? 3 : self ? 2 : 1);
            Root.BorderBrush = Brush.Parse(speaking ? "#2E9A64" : self ? "#8C8886" : "#1826262E");
            name.Text = J.Text(user, "name"); distance.Text = self ? "あなた" : FormatDistance(room.Distance(user));
            AutomationProperties.SetName(profile, name.Text + " のプロフィール"); ToolTip.SetTip(profile, name.Text + " のプロフィール");
            var nextIcon = name.Text + "|" + J.Text(user, "icon");
            if (iconKey != nextIcon) { iconKey = nextIcon; fullIcon.Content = room.Face(user, 18); smallIcon.Content = room.Face(user, 16); }
            var nextMicrophone = J.Bool(user, "micOn") ? "speaking" : "micOff";
            if (microphoneKey != nextMicrophone) { microphoneKey = nextMicrophone; microphone.Content = new WebIcon(nextMicrophone, 12, Brush.Parse(nextMicrophone == "speaking" ? "#7FE0A8" : "#F6A79C")); }
            badge.IsVisible = J.Text(user, "mode") == "3d";
            var last = room._ctx.State.Chats.LastOrDefault(m => J.Text(m, "from") == id && J.Text(m, "text") != "" && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - J.Number(m, "at") < 30000);
            bubbleText.Text = J.Text(last, "text");
        }

        public void Layout(double width, bool small, bool gallery)
        {
            Root.Width = button.Width = portrait.Width = width; Root.Height = button.Height = portrait.Height = width * .75;
            Root.CornerRadius = button.CornerRadius = new CornerRadius(small ? 10 : 14);
            portrait.Small = small; footer.IsVisible = profile.IsVisible = !small; smallIcon.IsVisible = small;
            name.FontSize = gallery ? 13 : 12; footer.Height = gallery ? 28 : 24;
            bubble.IsVisible = !small && !string.IsNullOrEmpty(bubbleText.Text);
        }
    }
}
