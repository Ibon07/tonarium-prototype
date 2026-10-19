import { Chess, type Move, type PieceSymbol } from 'chess.js';
import { chessBoard, chessView, playChess, squareIndex, type ChessState, type Promotion } from '../shared/chess.ts';
import type { ChessItem, Item } from '../shared/items.ts';

const VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100_000;

/** Positive scores favor the side to move. Encourage development and central control. */
function evaluate(game: Chess) {
  let score = 0;
  for (const [row, rank] of game.board().entries()) {
    for (const [col, piece] of rank.entries()) {
      if (!piece) continue;
      const center = 7 - Math.abs(col - 3.5) - Math.abs(row - 3.5);
      const development = piece.type === 'p' ? (piece.color === 'w' ? 6 - row : row - 1) * 8
        : piece.type === 'n' || piece.type === 'b' ? center * 12 : 0;
      score += (piece.color === game.turn() ? 1 : -1) * (VALUE[piece.type] + development);
    }
  }
  return score;
}

function ordered(moves: Move[]) {
  const priority = (m: Move) => (m.san.endsWith('#') ? MATE : 0)
    + (m.captured ? VALUE[m.captured] * 10 - VALUE[m.piece] : 0)
    + (m.promotion ? VALUE[m.promotion] : 0);
  return moves.sort((a, b) => priority(b) - priority(a));
}

/** Iterative-deepening negamax. A short deadline bounds work per shared board. */
export function chooseChessAiMove(state: ChessState, budgetMs = 60): Move | null {
  const view = chessView(state);
  if (view.over || view.turn !== 'b') return null;
  const game = new Chess(state.fen);
  const candidates = ordered(game.moves({ verbose: true }));
  let best = candidates[0] ?? null;
  const deadline = performance.now() + budgetMs;
  let timedOut = false;
  const search = (depth: number, alpha: number, beta: number, ply: number): number => {
    if (performance.now() >= deadline) { timedOut = true; return 0; }
    if (game.isCheckmate()) return -MATE + ply;
    if (game.isDraw()) return 0;
    if (depth === 0) return evaluate(game);
    let score = -Infinity;
    for (const move of ordered(game.moves({ verbose: true }))) {
      game.move(move);
      const value = -search(depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (timedOut) return 0;
      score = Math.max(score, value);
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return score;
  };
  for (let depth = 1; depth <= 3; depth++) {
    let iterationBest = best;
    let alpha = -Infinity;
    for (const move of candidates) {
      game.move(move);
      const score = -search(depth - 1, -Infinity, -alpha, 1);
      game.undo();
      if (timedOut) break;
      if (score > alpha) { alpha = score; iterationBest = move; }
    }
    if (timedOut) break;
    best = iterationBest;
    if (alpha >= MATE - 10) break;
  }
  return best;
}

/** Never apply an old reply after reset, removal, or a replacement position. */
export function applyChessAiReply(item: ChessItem, expected: ChessState, move: Move): boolean {
  if (item.kind !== 'chessAi' || item.chess !== expected || chessView(item.chess).turn !== 'b') return false;
  const next = playChess(item.chess, squareIndex(move.from), squareIndex(move.to), expected.revision, move.promotion as Promotion | undefined);
  if (!next) return false;
  item.chess = next;
  item.board = chessBoard(next);
  item.last = [squareIndex(move.from), squareIndex(move.to)];
  return true;
}

export function scheduleChessAiReply(item: ChessItem, current: () => Item | undefined, publish: () => void, delayMs = 350) {
  if (item.kind !== 'chessAi' || chessView(item.chess).turn !== 'b' || chessView(item.chess).over) return;
  const expected = item.chess;
  return setTimeout(() => {
    if (current() !== item || item.chess !== expected) return;
    const move = chooseChessAiMove(expected);
    if (move && applyChessAiReply(item, expected, move)) publish();
  }, delayMs);
}
