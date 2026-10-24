import { memo } from 'react';
import type { AntimatterSlice, DimensionDerived } from './types.ts';
import { formatNumber } from './format.ts';
import { dimensionMultiplierText, s, TIER_EN } from './styles.ts';

function DimensionRow({ d, boosts, sacrificeBoost, buyDimension, buyUntilNextTen }: {
  d: DimensionDerived;
  boosts: number;
  sacrificeBoost: AntimatterSlice['game']['sacrificeBoost'];
  buyDimension: AntimatterSlice['buyDimension'];
  buyUntilNextTen: AntimatterSlice['buyUntilNextTen'];
}) {
  if (d.locked) {
    return (
      <div style={s.dimRowLocked}>
        <span>第{d.tier}次元 <span style={s.muted}>{TIER_EN[d.tier - 1]} Dimension</span></span>
        <span style={s.muted}>🔒 未解放 - Dimension Boost で解放</span>
      </div>
    );
  }
  return (
    <div style={s.dimRow}>
      <div>
        <div>第{d.tier}次元 <span style={s.muted}>{TIER_EN[d.tier - 1]} Dimension</span></div>
        <div style={s.big}>{formatNumber(d.amount)}</div>
        <div style={s.muted}>
          購入数: {d.bought} · 生産: {formatNumber(d.productionPerSecond)} /秒 · 倍率: {dimensionMultiplierText(d.tier, d.bought, boosts, sacrificeBoost)}
          <br />次の×2まで あと {d.nextMilestoneRemaining} 個
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
        <button style={s.btn} disabled={!d.affordable} onClick={() => buyDimension(d.tier)}>
          1個買う<br /><small>コスト: {formatNumber(d.cost)}</small>
        </button>
        <button style={s.btn} disabled={!d.affordable} onClick={() => buyUntilNextTen(d.tier)}>10個まで買う</button>
      </div>
    </div>
  );
}

const MemoRow = memo(DimensionRow);

export function DimensionList({ ad }: { ad: AntimatterSlice }) {
  const { derived, game } = ad;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={s.row}>
        <span>🔥 Tickspeed: ×{derived.tickspeedValue >= 10000 ? formatNumber(derived.tickspeedValue) : derived.tickspeedValue.toFixed(2)}</span>
        <span style={s.muted}>購入数: {derived.tickspeedBought} · 1購入あたり ×{derived.tickspeedPerPurchase.toFixed(4)}</span>
        <span style={{ flex: 1 }} />
        <button style={s.btn} disabled={!derived.tickspeedAffordable} onClick={() => ad.buyTickspeed()}>
          Tickspeed を買う（コスト: {formatNumber(derived.tickspeedCost)}）
        </button>
        <button style={s.btn} onClick={() => ad.buyMax()}>Max All（買えるものをすべて買う）</button>
      </div>
      {derived.dimensions.map((d) => (
        <MemoRow
          key={d.tier} d={d} boosts={game.dimensionalBoosts} sacrificeBoost={game.sacrificeBoost}
          buyDimension={ad.buyDimension} buyUntilNextTen={ad.buyUntilNextTen}
        />
      ))}
    </div>
  );
}
