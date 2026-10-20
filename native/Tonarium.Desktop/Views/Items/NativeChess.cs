using System.Text.Json.Nodes;

namespace Tonarium.Desktop.Views;

/// <summary>UI legality preview. The room server remains authoritative for every move and revision.</summary>
internal sealed class NativeChess
{
    public sealed record Move(int From, int To, string? Promotion = null, bool EnPassant = false, bool Castle = false);
    public string?[] Board { get; private set; } = new string?[64];
    public char Turn { get; private set; } = 'w';
    private string castling = "";
    private int enPassant = -1;
    private int halfMove;
    private string positionKey = "";
    public NativeChess(string fen)
    {
        var parts = fen.Split(' '); if (parts.Length < 2) return;
        positionKey = string.Join(" ", parts.Take(4));
        Turn = parts[1] == "b" ? 'b' : 'w'; castling = parts.Length > 2 ? parts[2] : "";
        enPassant = parts.Length > 3 && parts[3] != "-" ? SquareIndex(parts[3]) : -1;
        halfMove = parts.Length > 4 && int.TryParse(parts[4], out var hm) ? hm : 0;
        int index = 0;
        foreach (char c in parts[0]) { if (c == '/') continue; if (char.IsDigit(c)) index += c - '0'; else if (index < 64) Board[index++] = (char.IsUpper(c) ? "w" : "b") + char.ToUpperInvariant(c); }
    }
    private NativeChess(NativeChess p) { Board = (string?[])p.Board.Clone(); Turn = p.Turn; castling = p.castling; enPassant = p.enPassant; halfMove = p.halfMove; positionKey = p.positionKey; }
    public static string SquareName(int i) => "abcdefgh"[i % 8].ToString() + (8 - i / 8);
    private static int SquareIndex(string s) => s.Length < 2 ? -1 : (8 - (s[1] - '0')) * 8 + "abcdefgh".IndexOf(s[0]);
    public static string Glyph(string p) => (p[0], p[1]) switch { ('w', 'K') => "♔", ('w', 'Q') => "♕", ('w', 'R') => "♖", ('w', 'B') => "♗", ('w', 'N') => "♘", ('w', 'P') => "♙", (_, 'K') => "♚", (_, 'Q') => "♛", (_, 'R') => "♜", (_, 'B') => "♝", (_, 'N') => "♞", _ => "♟" };
    private static char Other(char color) => color == 'w' ? 'b' : 'w';
    private static bool Inside(int r, int c) => r >= 0 && r < 8 && c >= 0 && c < 8;

    public List<Move> LegalMoves(int from)
    {
        if (from < 0 || from >= 64 || Board[from] is not { } piece || piece[0] != Turn) return [];
        return Candidates(from).Where(m => { var next = new NativeChess(this); next.Apply(m); return !next.InCheck(Turn); }).ToList();
    }
    public List<Move> AllLegal() { var result = new List<Move>(); for (int i = 0; i < 64; i++) result.AddRange(LegalMoves(i)); return result; }
    public bool IsOver(JsonArray positions)
    {
        if (halfMove >= 100 || positions.Count(p => p?.ToString() == positionKey) >= 3) return true;
        var pieces = Board.Select((p, i) => (p, i)).Where(x => x.p is not null && x.p[1] != 'K').ToArray();
        if (pieces.Length == 0 || pieces.Length == 1 && "BN".Contains(pieces[0].p![1])) return true;
        if (pieces.Length > 0 && pieces.All(x => x.p![1] == 'B') && pieces.Select(x => (x.i / 8 + x.i % 8) % 2).Distinct().Count() == 1) return true;
        return AllLegal().Count == 0;
    }
    public bool InCheck(char color) { int king = Array.IndexOf(Board, color + "K"); return king >= 0 && Attacked(king, Other(color)); }
    private bool Attacked(int square, char by)
    {
        int r = square / 8, c = square % 8;
        for (int i = 0; i < 64; i++)
        {
            if (Board[i] is not { } p || p[0] != by) continue;
            int pr = i / 8, pc = i % 8, dr = r - pr, dc = c - pc;
            if (p[1] == 'P') { if (dr == (by == 'w' ? -1 : 1) && Math.Abs(dc) == 1) return true; continue; }
            if (p[1] == 'N') { if (Math.Abs(dr) * Math.Abs(dc) == 2) return true; continue; }
            if (p[1] == 'K') { if (Math.Max(Math.Abs(dr), Math.Abs(dc)) == 1) return true; continue; }
            bool diagonal = Math.Abs(dr) == Math.Abs(dc) && dr != 0; bool straight = (dr == 0) != (dc == 0);
            if (!(p[1] == 'Q' && (diagonal || straight) || p[1] == 'B' && diagonal || p[1] == 'R' && straight)) continue;
            int sr = Math.Sign(dr), sc = Math.Sign(dc), rr = pr + sr, cc = pc + sc; bool clear = true;
            while (rr != r || cc != c) { if (Board[rr * 8 + cc] is not null) { clear = false; break; } rr += sr; cc += sc; }
            if (clear) return true;
        }
        return false;
    }
    private IEnumerable<Move> Candidates(int from)
    {
        var p = Board[from]!; int r = from / 8, c = from % 8;
        bool Available(int to) => Board[to] is null || Board[to]![0] != Turn && Board[to]![1] != 'K';
        IEnumerable<Move> PawnMove(int to, bool ep = false) => to / 8 is 0 or 7 ? new[] { "q", "r", "b", "n" }.Select(s => new Move(from, to, s, ep)) : [new Move(from, to, EnPassant: ep)];
        if (p[1] == 'P')
        {
            int step = Turn == 'w' ? -1 : 1, nr = r + step;
            if (!Inside(nr, c)) yield break;
            int forward = nr * 8 + c;
            if (Board[forward] is null) { foreach (var move in PawnMove(forward)) yield return move; int twice = (r + step * 2) * 8 + c; if ((r == 6 && Turn == 'w' || r == 1 && Turn == 'b') && Board[twice] is null) yield return new Move(from, twice); }
            foreach (var dc in new[] { -1, 1 }) if (Inside(nr, c + dc)) { int to = nr * 8 + c + dc; if (Board[to] is not null && Available(to)) { foreach (var move in PawnMove(to)) yield return move; } else if (to == enPassant && Board[r * 8 + c + dc] == Other(Turn) + "P") yield return new Move(from, to, EnPassant: true); }
            yield break;
        }
        (int, int)[] dirs = p[1] switch { 'N' => [(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)], 'B' => [(-1,-1),(-1,1),(1,-1),(1,1)], 'R' => [(-1,0),(1,0),(0,-1),(0,1)], _ => [(-1,-1),(-1,1),(1,-1),(1,1),(-1,0),(1,0),(0,-1),(0,1)] };
        foreach (var (dr, dc) in dirs)
        {
            int nr = r + dr, nc = c + dc;
            while (Inside(nr, nc)) { int to = nr * 8 + nc; if (Available(to)) yield return new Move(from, to); if (Board[to] is not null || p[1] is 'K' or 'N') break; nr += dr; nc += dc; }
        }
        if (p[1] != 'K' || from != (Turn == 'w' ? 60 : 4) || InCheck(Turn)) yield break;
        var enemy = Other(Turn);
        if (castling.Contains(Turn == 'w' ? 'K' : 'k') && Board[from + 3] == Turn + "R" && Board[from + 1] is null && Board[from + 2] is null && !Attacked(from + 1, enemy) && !Attacked(from + 2, enemy)) yield return new Move(from, from + 2, Castle: true);
        if (castling.Contains(Turn == 'w' ? 'Q' : 'q') && Board[from - 4] == Turn + "R" && Board[from - 1] is null && Board[from - 2] is null && Board[from - 3] is null && !Attacked(from - 1, enemy) && !Attacked(from - 2, enemy)) yield return new Move(from, from - 2, Castle: true);
    }
    private void Apply(Move m)
    {
        var piece = Board[m.From]; Board[m.From] = null; Board[m.To] = m.Promotion is null ? piece : Turn + m.Promotion.ToUpperInvariant();
        if (m.EnPassant) Board[m.To + (Turn == 'w' ? 8 : -8)] = null;
        if (m.Castle) { int rook = m.To > m.From ? m.From + 3 : m.From - 4; int dest = m.To > m.From ? m.From + 1 : m.From - 1; Board[dest] = Board[rook]; Board[rook] = null; }
    }
}
