import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AntimatterPanelProps } from './types.ts';
import { formatDurationMs, formatNumber } from './format.ts';
import { s } from './styles.ts';
import { DimensionList } from './DimensionList.tsx';
import { ActionBar } from './ActionBar.tsx';
import { StatsPanel } from './StatsPanel.tsx';
import { ProfilePanel } from './ProfilePanel.tsx';
import { LayerTabs } from './LayerTabs.tsx';

type TabId = 'dimensions' | 'actions' | 'stats' | 'profiles' | 'layers';

const TABS: { id: TabId; label: string }[] = [
  { id: 'dimensions', label: '次元' },
  { id: 'actions', label: 'Boost / 銀河 / Sacrifice / Crunch' },
  { id: 'stats', label: '統計・実績・ランキング' },
  { id: 'profiles', label: 'プロフィール・セーブ' },
  { id: 'layers', label: 'レイヤー' },
];

export function AntimatterPanel({ ad }: AntimatterPanelProps) {
  const [tab, setTab] = useState<TabId>('dimensions');
  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = (msg: string) => setNotice(msg);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const { game, derived } = ad;
  const offline = ad.offlineNotice;
  const offlineGained = offline && (offline.antimatterGained.mantissa ?? 0) !== 0 && offline.elapsedMs >= 5000;

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.muted}>反物質</span>
        <span style={s.big}>{formatNumber(game.antimatter)}</span>
        <span style={s.muted}>{formatNumber(derived.antimatterPerSecond)} /秒</span>
        <span style={s.muted}>IP: {formatNumber(game.infinityPoints)}</span>
        <span style={s.muted}>Boost: {game.dimensionalBoosts} · 銀河: {game.galaxies}</span>
        <span style={{ flex: 1 }} />
        {ad.activeProfile && <span style={s.muted}>{ad.activeProfile.name}</span>}
      </div>
      <div style={s.tabs}>
        {TABS.map((t) => (
          <button key={t.id} style={t.id === tab ? s.tabActive : s.tab} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {notice && <div style={s.notice}>{notice}</div>}
      {tab === 'dimensions' && <DimensionList ad={ad} />}
      {tab === 'actions' && <ActionBar ad={ad} notice={showNotice} />}
      {tab === 'stats' && <StatsPanel ad={ad} notice={showNotice} />}
      {tab === 'profiles' && <ProfilePanel ad={ad} notice={showNotice} />}
      {tab === 'layers' && <LayerTabs ad={ad} />}
      {offlineGained && createPortal(
        <div style={s.modal} onClick={() => ad.dismissOffline()}>
          <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>おかえりなさい</h3>
            <p style={{ margin: 0 }}>
              {formatDurationMs(offline.simulatedMs)} の離席中に、反物質が {formatNumber(offline.antimatterGained)} 増えました！（現在 {formatNumber(game.antimatter)}）
              {offline.simulatedMs < offline.elapsedMs ? ' ※オフライン進行は最大8時間まで計算されます。' : ''}
            </p>
            <button style={s.btn} onClick={() => ad.dismissOffline()}>閉じる</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
