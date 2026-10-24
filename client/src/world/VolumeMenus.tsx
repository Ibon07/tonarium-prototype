import { useStore } from '../store.ts';
import { peerLevel, setMasterVolume, setPeerVolume, togglePeerMute, type VolumeKind } from '../volume.ts';
import { Popover } from './common.tsx';
import { Icon } from './Icon.tsx';

const KINDS: { kind: VolumeKind; label: string }[] = [
  { kind: 'voice', label: '人の声' },
  { kind: 'fx', label: 'サウンドボード・効果音' },
  { kind: 'media', label: '動画・画面共有' },
];

function Slider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="volrow">
      <span className="vollabel"><span>{label}</span><b>{Math.round(value * 100)}%</b></span>
      <input type="range" min={0} max={max} step={0.05} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** ドックから開く全体の音量 */
export function MasterVolume({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const vol = useStore((s) => s.audioVol);
  return (
    <Popover anchor={anchor} side="up" onClose={onClose} className="volume">
      <span className="menutitle">音量（自分だけ）</span>
      {KINDS.map((k) => <Slider key={k.kind} label={k.label} value={vol[k.kind]} max={1} onChange={(v) => setMasterVolume(k.kind, v)} />)}
    </Popover>
  );
}

/** プレイヤーの行の右クリックで開く、その人の声の音量 */
export function PeerVolume({ name, anchor, onClose }: { name: string; anchor: DOMRect; onClose: () => void }) {
  const level = useStore((s) => peerLevel(name, s));
  const muted = useStore((s) => s.peerMuted.includes(name));
  return (
    <Popover anchor={anchor} onClose={onClose} className="volume">
      <span className="menutitle">{name} の声の音量（自分だけ）</span>
      <Slider label="音量" value={level} max={2} onChange={(v) => setPeerVolume(name, v)} />
      <div className="volbtns">
        <button className={`ib menuitem ${muted ? 'on' : ''}`} onClick={() => togglePeerMute(name)}>
          <Icon name={muted ? 'volumeOff' : 'volume'} />{muted ? 'ミュートを解除' : 'ミュート'}
        </button>
        <button className="ib menuitem" disabled={level === 1} onClick={() => setPeerVolume(name, 1)}>100% に戻す</button>
      </div>
    </Popover>
  );
}
