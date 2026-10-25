import { useStore } from '../store.ts';
import { formatNumber, getAntimatterPerSecond, getMaxUnlockedTier } from '../ad/engine.mjs';
import { LabArt } from '../world/antimatter/LabArt.tsx';
import './antimatterHud.css';

/** DOM overlay stays visible while walking, without invalidating the Three scene on each tick. */
export function AntimatterHud() {
  // The engine mutates GameState in place. Subscribe to its version, not its object identity.
  useStore((s) => s.adVersion);
  const game = useStore((s) => s.adGame);
  if (!game) return null;

  return (
    <div className="ad-hud-slot">
      <section className="ad-hud" aria-label="AD 研究所の反物質">
        <div className="ad-hud-art"><LabArt kind="reactor" size={72} /></div>
        <div className="ad-hud-readout">
          <div className="ad-hud-label"><span className="ad-hud-light" />反物質 <span>ANTIMATTER</span></div>
          <strong className="ad-hud-total" data-testid="ad-hud-antimatter">{formatNumber(game.antimatter)}</strong>
          <div className="ad-hud-rate" data-testid="ad-hud-rate">+{formatNumber(getAntimatterPerSecond(game))}<span> / 秒</span></div>
        </div>
        <div className="ad-hud-milestones">
          <span>次元 <b>{getMaxUnlockedTier(game)} / 8</b></span>
          <span>Boost <b>{game.dimensionalBoosts}</b></span>
          <span>銀河 <b>{game.galaxies}</b></span>
        </div>
      </section>
    </div>
  );
}
