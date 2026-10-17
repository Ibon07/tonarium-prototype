import { useRef, useState } from 'react';
import { ROOM_HALF, NOTE_COLORS, type Note } from '../../../shared/protocol.ts';
import { useStore, colorOf, nameOf } from '../store.ts';
import { ShareVideoHost } from '../ShareVideo.tsx';
import { createNote, deleteNote, selectNote, updateNote } from '../actions.ts';

function StreamPanel() {
  const sharer = useStore((s) => s.sharer);
  useStore((s) => s.participants); // 名前解決のため購読
  if (!sharer) return <div className="stream empty">配信はありません。ヘッダーの「画面を配信」で開始できます</div>;
  return (
    <div className="stream">
      <ShareVideoHost className="videohost" />
      <div className="caption">🔴 {nameOf(sharer)} の配信</div>
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  const selfId = useStore((s) => s.selfId);
  const selected = useStore((s) => s.selectedNote === note.id);
  useStore((s) => s.participants);
  const lockedByOther = note.editingBy && note.editingBy !== selfId;
  return (
    <div className={`card ${selected ? 'selected' : ''}`} style={{ background: note.color }}>
      <textarea
        value={note.text}
        placeholder="（空の付箋）"
        onFocus={() => selectNote(note.id)}
        onBlur={() => selectNote(null)}
        onChange={(e) => updateNote(note.id, { text: e.target.value })}
      />
      <div className="cardfoot">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} onClick={() => updateNote(note.id, { color: c })} />
        ))}
        <div className="spacer" />
        <button className="small" onClick={() => deleteNote(note.id)}>削除</button>
      </div>
      <div className="meta">
        {lockedByOther ? `✏️ ${nameOf(note.editingBy)} が編集中` : `更新: ${nameOf(note.updatedBy)}`}
      </div>
    </div>
  );
}

function NoteBoard() {
  const notes = useStore((s) => s.notes);
  const [text, setText] = useState('');
  const add = () => {
    createNote(text.trim());
    setText('');
  };
  const list = Object.values(notes).sort((a, b) => a.updatedAt - b.updatedAt);
  return (
    <section className="board">
      <h3>付箋（3D空間にも置かれます）</h3>
      <div className="addnote">
        <input
          placeholder="付箋に書く内容" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
        />
        <button className="primary" onClick={add}>付箋を追加</button>
      </div>
      <div className="cards">
        {list.map((n) => <NoteCard key={n.id} note={n} />)}
      </div>
    </section>
  );
}

/** 3D空間を上から見た簡易マップ。付箋はドラッグで移動できる */
function MiniMap() {
  const { avatars, notes, participants, speaking, selfId, sharer } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; last: number } | null>(null);

  const toRoom = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, z: p.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const now = performance.now();
    if (now - drag.current.last < 60) return;
    drag.current.last = now;
    updateNote(drag.current.id, toRoom(e));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    updateNote(drag.current.id, toRoom(e));
    drag.current = null;
  };
  const in2d = participants.filter((p) => p.mode === '2d');
  const in3d = participants.filter((p) => p.mode === '3d');
  const H = ROOM_HALF;

  return (
    <section className="map">
      <h3>3D空間のようす <small>（3D: {in3d.length}人 / 付箋はドラッグで移動）</small></h3>
      <svg
        ref={svgRef} viewBox={`${-H - 0.5} ${-H - 0.5} ${2 * H + 1} ${2 * H + 1}`}
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <rect x={-H} y={-H} width={2 * H} height={2 * H} className="floor" />
        <line x1={-4} y1={-H + 0.2} x2={4} y2={-H + 0.2} className={`screen ${sharer ? 'live' : ''}`} />
        <text x={0} y={-H + 1.2} className="label" textAnchor="middle">スクリーン{sharer ? '（配信中）' : ''}</text>
        {Object.values(notes).map((n) => (
          <g
            key={n.id} transform={`translate(${n.x} ${n.z}) rotate(${(-n.ry * 180) / Math.PI})`}
            className="mapnote"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              drag.current = { id: n.id, last: 0 };
            }}
          >
            <rect x={-0.6} y={-0.15} width={1.2} height={0.3} fill={n.color} stroke={n.editingBy ? '#f43f5e' : '#555'} strokeWidth={0.06} />
            <text y={0.9} className="label" textAnchor="middle">{n.text.slice(0, 8) || '付箋'}</text>
          </g>
        ))}
        {Object.entries(avatars).map(([id, a]) => {
          const name = participants.find((p) => p.id === id)?.name;
          if (!name || id === selfId) return null;
          return (
            <g key={id} transform={`translate(${a.x} ${a.z})`}>
              {speaking[id] && <circle r={0.9} className="speakring" />}
              <circle r={0.5} fill={colorOf(id)} />
              <line x1={0} y1={0} x2={-Math.sin(a.ry) * 1} y2={-Math.cos(a.ry) * 1} stroke={colorOf(id)} strokeWidth={0.15} />
              <text y={-0.8} className="label" textAnchor="middle">{name}</text>
            </g>
          );
        })}
      </svg>
      <div className="twod">2Dで参加中: {in2d.map((p) => p.name).join('、') || 'なし'}</div>
    </section>
  );
}

export function View2D() {
  return (
    <div className="view2d">
      <StreamPanel />
      <div className="row">
        <NoteBoard />
        <MiniMap />
      </div>
    </div>
  );
}
