using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Tonarium.Desktop.Core;

namespace Tonarium.Desktop.Views;

// Web SurvivorCanvas と同じ 360px 座標・色・650ms の攻撃演出。
internal sealed class SurvivorMap(ClientState state) : Control
{
    private static readonly string[] Players = ["#ff8ab2", "#8ed9ff", "#e1b0ff", "#ffd36d", "#9af0bd"];
    private static IBrush Color(string color) => Brush.Parse(color);
    private static string Attack(string gear) => gear switch { "moonblade" => "#ff65aa", "eclipse" => "#ffe675", "bloodaura" => "#ff315e", "crimsonsun" => "#ff9d35", "starbolt" => "#5fe5ff", "starfall" => "#ffe16e", "shade" => "#bc8aff", "umbralstorm" => "#a457ff", _ => "#fff3a6" };
    public override void Render(DrawingContext dc)
    {
        base.Render(dc);
        var size = Math.Min(Bounds.Width, Bounds.Height); var left = (Bounds.Width - size) / 2;
        using var transform = dc.PushTransform(Matrix.CreateScale(size / 360, size / 360) * Matrix.CreateTranslation(left, 0));
        using var clip = dc.PushClip(new RoundedRect(new Rect(0, 0, 360, 360), 12));
        var half = SurvivorPanel.RoomHalf; var scale = 360 / (half * 2);
        Point Point(double x, double z) => new(180 + x * scale, 180 + z * scale);
        void Circle(string? fill, string? stroke, Point p, double r, double width = 1) => dc.DrawEllipse(fill is null ? null : Color(fill), stroke is null ? null : new Pen(Color(stroke), width), p, r, r);
        dc.DrawRectangle(Color("#565961"), null, new Rect(0, 0, 360, 360));
        for (var i = -half; i <= half; i += 2) { dc.DrawLine(new Pen(Color("#1cffffff")), Point(i, -half), Point(i, half)); dc.DrawLine(new Pen(Color("#1cffffff")), Point(-half, i), Point(half, i)); }
        dc.DrawRectangle(null, new Pen(Color("#aeb1bb"), 3), new Rect(0, 0, 360, 360));
        Circle("#33ef6b9b", "#ff9ac8", Point(SurvivorPanel.JoinX, SurvivorPanel.JoinZ), SurvivorPanel.JoinRadius * scale, 2);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + state.ServerOffset;
        if (J.Text(state.Survivor, "phase", "lobby") == "lobby")
        {
            var i = 0;
            foreach (var user in state.Users.Where(u => J.Text(u, "session") == state.SessionId))
            {
                var position = SurvivorPanel.PositionOf(state, user!);
                Circle(Players[i++ % Players.Length], null, Point(position.X, position.Z), 6);
            }
        }
        foreach (var enemy in J.Array(state.Survivor, "enemies"))
        {
            var p = Point(J.Number(enemy, "x"), J.Number(enemy, "z")); var kind = J.Text(enemy, "kind"); var boss = kind == "boss";
            var age = now - J.Number(enemy, "hitAt"); var hit = age >= 0 && age < 240 ? 1 - age / 240 : 0;
            var radius = (boss ? 11 : kind == "knight" ? 6 : 4.5) * (1 + hit * .35);
            Circle(hit > 0 ? "#fff4f7" : boss ? "#ff315d" : kind == "knight" ? "#bd81d0" : kind == "bat" ? "#a17de0" : "#df6287", null, p, radius);
            if (hit > 0 || boss) using (dc.PushOpacity(hit > 0 ? hit : .8)) Circle(null, hit > 0 ? "#ffffff" : "#ff5275", p, radius + (hit > 0 ? 3 + (1 - hit) * 4 : 4), hit > 0 ? 2 : 1.5);
        }
        var playerIndex = 0;
        foreach (var (id, player) in J.Object(state.Survivor, "players"))
        {
            var p = Point(J.Number(player, "x"), J.Number(player, "z")); var age = now - J.Number(player, "hitAt"); var hit = age >= 0 && age < 300 ? 1 - age / 300 : 0;
            if (hit > 0) using (dc.PushOpacity(hit)) Circle(null, "#ff6e88", p, 12 + (1 - hit) * 8, 3);
            var playerColor = Players[playerIndex++ % Players.Length];
            Circle(hit > 0 ? "#fff2ee" : playerColor, id == state.SelfId ? "#ffffff" : null, p, id == state.SelfId ? 8 : 6, 2);
        }
        foreach (var effect in J.Array(state.Survivor, "effects"))
        {
            var age = now - J.Number(effect, "at"); if (age < 0 || age > 650) continue;
            var progress = age / 650; var alpha = 1 - progress; var from = effect?["from"]; var a = Point(J.Number(from, "x"), J.Number(from, "z"));
            var gear = J.Text(effect, "gear"); var color = Attack(gear);
            using var opacity = dc.PushOpacity(alpha);
            if (gear is "moonblade" or "eclipse" or "bloodaura" or "crimsonsun")
            {
                var r = Math.Max(4, J.Number(effect, "reach") * scale * (.18 + progress * .82));
                var gradient = new RadialGradientBrush { GradientStops = new GradientStops { new GradientStop(Avalonia.Media.Color.Parse("#58" + color[1..]), 0), new GradientStop(Avalonia.Media.Color.Parse("#24" + color[1..]), .72), new GradientStop(Avalonia.Media.Color.Parse("#00" + color[1..]), 1) } };
                dc.DrawEllipse(gradient, new Pen(Color(color), 5 * alpha + 1), a, r, r);
                Circle(null, "#fff2cf", a, Math.Max(2, r * .66), 2); Circle("#ffffff", null, a, 4 + progress * 5);
            }
            else foreach (var target in J.Array(effect, "targets"))
            {
                var b = Point(J.Number(target, "x"), J.Number(target, "z"));
                using (dc.PushOpacity(.18)) dc.DrawLine(new Pen(Color(color), 17, lineCap: PenLineCap.Round), a, b);
                dc.DrawLine(new Pen(Color(color), 9, lineCap: PenLineCap.Round), a, b);
                dc.DrawLine(new Pen(Color("#fff4e8"), 2, lineCap: PenLineCap.Round), a, b);
                var head = a + (b - a) * progress; var angle = Math.Atan2(b.Y - a.Y, b.X - a.X);
                Point Rotate(double x, double y) => new(head.X + x * Math.Cos(angle) - y * Math.Sin(angle), head.Y + x * Math.Sin(angle) + y * Math.Cos(angle));
                var geometry = new StreamGeometry(); using (var path = geometry.Open()) { path.BeginFigure(Rotate(9, 0), true); path.LineTo(Rotate(-5, -5)); path.LineTo(Rotate(-2, 0)); path.LineTo(Rotate(-5, 5)); path.EndFigure(true); }
                dc.DrawGeometry(Color(color), null, geometry);
                Circle("#38ffffff", "#ffffff", b, 7 + (1 - progress) * 7, 2.5);
                for (var i = 0; i < 6; i++) { var theta = i * Math.PI / 3 + progress * 1.5; var r = (5 + progress * 12) * (i % 2 != 0 ? .72 : 1); dc.DrawLine(new Pen(Color(i % 2 != 0 ? color : "#ffffff"), i % 2 != 0 ? 2 : 1), b + new Vector(Math.Cos(theta) * r, Math.Sin(theta) * r), b + new Vector(Math.Cos(theta) * (r + 4), Math.Sin(theta) * (r + 4))); }
            }
        }
    }
}
