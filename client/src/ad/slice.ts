import {
  antimatterGalaxy,
  bigLog10,
  buyDimension,
  buyMax,
  buyMaxDimension,
  buyMaxTickspeed,
  buyTickspeed,
  createNewGame,
  deserialize,
  dimensionalBoost,
  offlineProgress,
  prestigeInfinity,
  sacrifice,
  serialize,
  tick,
  type GameState,
  type OfflineResult,
} from './engine.mjs';
import {
  buildExportBundle,
  createAuthProvider,
  createProfile,
  ensureDefaultProfile,
  importBundleInto,
  readSaveRaw,
  switchProfile,
  writeSave,
  type AdProfile,
  type AuthProvider,
  type ExportBundle,
  type StorageLike,
} from './user.mjs';
import { safeStorage } from './storage.ts';
import { linkTonariumProfile } from './link.ts';
import { AdApiClient, type LeaderboardEntry } from './api.ts';

export interface AdStartOptions {
  /** 任意の上書き。未指定なら同一オリジン（Tonarium サーバー内の /api/*）を使い、Workers などの外部 API は必須ではない */
  apiBase?: string;
  authMode?: 'anonymous' | 'token' | 'header-injected';
  authToken?: string;
  storage?: StorageLike;
  tonariumId?: string;
  tonariumName?: string;
}

export interface AdSlice {
  adProfile: AdProfile | null;
  adGame: GameState | null;
  adVersion: number;
  adOffline: OfflineResult | null;
  adServer: 'local' | 'connected' | 'error';
  adLastLocalSaveAt: number | null;
  adLastServerSaveAt: number | null;
  adLeaderboard: LeaderboardEntry[];
  adStart: (options?: AdStartOptions) => void;
  adStop: () => void;
  adBindTonarium: (selfId: string, selfName: string) => void;
  adBuyDimension: (tier: number) => boolean;
  adBuyDimensionMax: (tier: number) => void;
  adBuyMax: () => void;
  adBuyTickspeed: () => boolean;
  adBuyMaxTickspeed: () => void;
  adBoost: () => boolean;
  adGalaxy: () => boolean;
  adSacrifice: () => boolean;
  adPrestige: () => boolean;
  adCreateProfile: (name: string) => AdProfile;
  adSwitchProfile: (userId: string) => void;
  adSaveLocal: () => boolean;
  adSaveServer: () => Promise<boolean>;
  adLoadServer: () => Promise<boolean>;
  adSubmitScore: () => Promise<boolean>;
  adExport: () => ExportBundle | null;
  adImport: (bundle: ExportBundle) => AdProfile;
}

export type AdSet = (partial: Partial<AdSlice>) => void;
export type AdGet = () => AdSlice;

export function createAdSlice(set: AdSet, get: AdGet): AdSlice {
  let started = false;
  let timers: number[] = [];
  let storage: StorageLike = safeStorage();
  let apiBase = '';
  let authMode: AdStartOptions['authMode'] = 'anonymous';
  let authToken: string | undefined;
  let api: AdApiClient | null = null;

  function makeAuth(profile: AdProfile): AuthProvider {
    return createAuthProvider({
      mode: authMode ?? 'anonymous',
      userId: profile.id,
      token: authMode === 'token' ? authToken : undefined,
    });
  }

  function saveLocalNow(): boolean {
    const { adProfile, adGame } = get();
    if (!adProfile || !adGame) return false;
    try {
      writeSave(storage, adProfile.id, serialize(adGame));
      set({ adLastLocalSaveAt: Date.now() });
      return true;
    } catch {
      return false;
    }
  }

  function loadProfileGame(profile: AdProfile): void {
    let game: GameState;
    let offline: OfflineResult | null = null;
    try {
      const raw = readSaveRaw(storage, profile.id);
      game = raw ? deserialize(raw) : createNewGame();
    } catch {
      game = createNewGame();
    }
    offline = offlineProgress(game, Date.now());
    set({ adProfile: profile, adGame: game, adOffline: offline, adVersion: get().adVersion + 1 });
    saveLocalNow();
    if (api) api.setAuth(makeAuth(profile));
  }

  function clearTimers(): void {
    for (const t of timers) clearInterval(t);
    timers = [];
  }

  const slice: AdSlice = {
    adProfile: null,
    adGame: null,
    adVersion: 0,
    adOffline: null,
    adServer: 'local',
    adLastLocalSaveAt: null,
    adLastServerSaveAt: null,
    adLeaderboard: [],

    adStart(options = {}) {
      if (started) return;
      started = true;
      storage = options.storage ?? safeStorage();
      authMode = options.authMode ?? 'anonymous';
      authToken = options.authToken;
      // 既定は同一オリジン（Tonarium サーバー内の /api/*）。空文字の AdApiClient は相対パス /api/... を叩く。
      // VITE_AD_API_BASE は任意の上書きで、Workers などの外部 API に向けたい場合にだけ指定する。
      apiBase = (options.apiBase ?? import.meta.env?.VITE_AD_API_BASE ?? '').trim().replace(/\/+$/, '');
      const profile = options.tonariumId
        ? linkTonariumProfile(storage, options.tonariumId, options.tonariumName ?? '')
        : ensureDefaultProfile(storage);
      api = new AdApiClient(apiBase, makeAuth(profile));
      loadProfileGame(profile);
      timers = [
        window.setInterval(() => {
          const game = get().adGame;
          if (!game) return;
          tick(game, 100);
          // エンジンはインプレース更新のため、参照は変わらない。購読を起こす版カウンタで知らせる
          set({ adVersion: get().adVersion + 1 });
        }, 100),
        window.setInterval(() => { saveLocalNow(); }, 1000),
        // サーバー保存は常に有効（既定は同一オリジンの Tonarium サーバー）。localStorage はフォールバックとして残る
        window.setInterval(() => { void slice.adSaveServer(); }, 30000),
      ];
    },

    adStop() {
      clearTimers();
      started = false;
      api = null;
    },

    adBindTonarium(selfId, selfName) {
      if (!started) {
        slice.adStart({ tonariumId: selfId, tonariumName: selfName });
        return;
      }
      loadProfileGame(linkTonariumProfile(storage, selfId, selfName));
    },

    adBuyDimension(tier) {
      const game = get().adGame;
      if (!game) return false;
      const ok = buyDimension(game, tier);
      if (ok) set({ adVersion: get().adVersion + 1 });
      return ok;
    },

    adBuyDimensionMax(tier) {
      const game = get().adGame;
      if (!game) return;
      buyMaxDimension(game, tier);
      set({ adVersion: get().adVersion + 1 });
    },

    adBuyMax() {
      const game = get().adGame;
      if (!game) return;
      buyMax(game);
      set({ adVersion: get().adVersion + 1 });
    },

    adBuyTickspeed() {
      const game = get().adGame;
      if (!game) return false;
      const ok = buyTickspeed(game);
      if (ok) set({ adVersion: get().adVersion + 1 });
      return ok;
    },

    adBuyMaxTickspeed() {
      const game = get().adGame;
      if (!game) return;
      buyMaxTickspeed(game);
      set({ adVersion: get().adVersion + 1 });
    },

    adBoost() {
      const game = get().adGame;
      if (!game) return false;
      const ok = dimensionalBoost(game);
      if (ok) set({ adVersion: get().adVersion + 1 });
      return ok;
    },

    adGalaxy() {
      const game = get().adGame;
      if (!game) return false;
      const ok = antimatterGalaxy(game);
      if (ok) set({ adVersion: get().adVersion + 1 });
      return ok;
    },

    adSacrifice() {
      const game = get().adGame;
      if (!game) return false;
      const ok = sacrifice(game);
      if (ok) set({ adVersion: get().adVersion + 1 });
      return ok;
    },

    adPrestige() {
      const game = get().adGame;
      if (!game) return false;
      const ok = prestigeInfinity(game);
      if (ok) set({ adVersion: get().adVersion + 1 });
      return ok;
    },

    adCreateProfile(name) {
      const profile = createProfile(storage, name);
      slice.adSwitchProfile(profile.id);
      return profile;
    },

    adSwitchProfile(userId) {
      loadProfileGame(switchProfile(storage, userId));
    },

    adSaveLocal() {
      return saveLocalNow();
    },

    async adSaveServer() {
      const { adProfile, adGame } = get();
      if (!api || !adProfile || !adGame) return false;
      try {
        await api.save(adProfile.id, JSON.parse(serialize(adGame)) as Record<string, unknown>);
        set({ adServer: 'connected', adLastServerSaveAt: Date.now() });
        return true;
      } catch {
        set({ adServer: 'error' });
        return false;
      }
    },

    async adLoadServer() {
      const { adProfile } = get();
      if (!api || !adProfile) return false;
      try {
        const save = await api.load(adProfile.id);
        if (!save) return false;
        const game = deserialize(save);
        const offline = offlineProgress(game, Date.now());
        set({ adGame: game, adOffline: offline, adVersion: get().adVersion + 1, adServer: 'connected' });
        saveLocalNow();
        return true;
      } catch {
        set({ adServer: 'error' });
        return false;
      }
    },

    async adSubmitScore() {
      const { adProfile, adGame } = get();
      if (!api || !adProfile || !adGame) return false;
      try {
        await api.submitScore({
          playerId: adProfile.id,
          name: adProfile.name,
          antimatterLog10: Number.isFinite(bigLog10(adGame.antimatter)) ? bigLog10(adGame.antimatter) : 0,
          infinities: adGame.infinities ?? 0,
          playTimeSec: Math.max(0, Math.floor((Date.now() - (adGame.createdAt || Date.now())) / 1000)),
        });
        const entries = await api.leaderboard();
        set({ adLeaderboard: entries });
        return true;
      } catch {
        set({ adServer: 'error' });
        return false;
      }
    },

    adExport() {
      const { adProfile, adGame } = get();
      if (!adProfile || !adGame) return null;
      return buildExportBundle(adProfile, JSON.parse(serialize(adGame)) as Record<string, unknown>);
    },

    adImport(bundle) {
      const current = get().adProfile;
      if (current) switchProfile(storage, current.id);
      // importBundleInto は保存済みアクティブ配下へ書くため、先に現プロフィールをアクティブ化しておく
      const result = importBundleInto(storage, bundle);
      loadProfileGame(result.profile);
      return result.profile;
    },
  };

  return slice;
}
