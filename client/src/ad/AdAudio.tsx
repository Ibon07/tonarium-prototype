import { useEffect } from 'react';
import { ANTIMATTER_CORE } from '../../../shared/antimatterLayout.ts';
import { get, useStore, worldKindOf } from '../store.ts';
import { fxVolume } from '../volume.ts';
import { bigLog10, getAntimatterPerSecond } from './engine.mjs';
import { subscribeAdFeedback } from './feedback.ts';
import { AdSoundPlayer } from './audio.ts';

/** Audio follows the open item or the physical lab, without adding a screen HUD. */
export function AdAudio() {
  useEffect(() => {
    const player = new AdSoundPlayer();
    const phoneWidth = window.matchMedia('(max-width: 720px)');
    let nextProductionAt = 0;
    let step = 0;

    function sceneActive() {
      const s = get();
      return s.joined && !!s.session && !s.hubOpen && !s.switching && !s.worldLoading && !document.hidden;
    }

    function panelVisible() {
      const s = get();
      if (s.phoneTab !== 'screen' && phoneWidth.matches) return false;
      const windows = s.maxWin ? s.windows.filter((w) => w.key === s.maxWin)
        : s.winMode === 'simple' ? s.windows.slice(-1) : s.windows;
      return windows.some(({ key }) => key === 'antimatter' || key === 'antimatter-space'
        || (key.startsWith('item:') && s.items[key.slice(5)]?.kind === 'antimatter'));
    }

    function contextGain() {
      const s = get();
      if (!sceneActive()) return 0;
      if (panelVisible()) return 1;
      if (s.mode !== '3d' || worldKindOf(s) !== 'antimatter') return 0;
      const distance = Math.hypot(s.selfAvatar.x - ANTIMATTER_CORE.x, s.selfAvatar.z - ANTIMATTER_CORE.z);
      return Math.max(0, Math.min(1, (12 - distance) / 8));
    }

    function sync() {
      player.setVolume(fxVolume());
      if (contextGain() === 0 || fxVolume() === 0) {
        player.stopProduction();
        nextProductionAt = 0;
      }
      if (!sceneActive()) player.stop();
    }

    function production() {
      const gain = contextGain();
      const game = get().adGame;
      if (!game || gain <= 0 || fxVolume() <= 0) return;
      const rate = getAntimatterPerSecond(game);
      if (rate.mantissa <= 0) { player.stopProduction(); nextProductionAt = 0; return; }
      const now = performance.now();
      if (now < nextProductionAt) return;
      const log = bigLog10(rate);
      // Production grows in pitch/pace gently; never emit one sound per game tick.
      nextProductionAt = now + 2600 - 800 * Math.min(1, Math.max(0, log) / 30);
      player.production(log, gain, step++);
    }

    const unsubscribeFeedback = subscribeAdFeedback((event) => {
      if (sceneActive()) player.play(event);
    });
    const unsubscribeStore = useStore.subscribe(sync);
    window.addEventListener('pointerdown', player.unlock, true);
    window.addEventListener('keydown', player.unlock, true);
    document.addEventListener('visibilitychange', sync);
    phoneWidth.addEventListener('change', sync);
    const timer = window.setInterval(production, 250);
    sync();
    return () => {
      window.clearInterval(timer);
      unsubscribeFeedback();
      unsubscribeStore();
      window.removeEventListener('pointerdown', player.unlock, true);
      window.removeEventListener('keydown', player.unlock, true);
      document.removeEventListener('visibilitychange', sync);
      phoneWidth.removeEventListener('change', sync);
      player.dispose();
    };
  }, []);
  return null;
}
