import type { AvatarState, Participant } from '../shared/protocol.ts';
import {
  SURVIVOR_DURATION_MS, SURVIVOR_TICK_MS, SURVIVOR_WORLD_LIMIT,
  SURVIVOR_GEAR, SURVIVOR_JOIN, SURVIVOR_MAX_ENEMIES, SURVIVOR_META_UPGRADES,
  SURVIVOR_MOVE_SPEED, SURVIVOR_STYLES, clampSurvivorPosition, newSurvivorState,
  survivorDistance, survivorXpFor, type SurvivorAchievement, type SurvivorEnemy,
  type SurvivorMetaUpgrade, type SurvivorPlayer, type SurvivorProfile, type SurvivorState, type SurvivorStyle,
} from '../shared/survivor.ts';
import { SPAWN } from '../shared/protocol.ts';

const states = new Map<string, SurvivorState>();
export const survivorOf = (sid: string) => {
  let state = states.get(sid);
  if (!state) { state = newSurvivorState(); states.set(sid, state); }
  return state;
};
export const clearSurvivor = (sid: string) => states.delete(sid);

export interface SurvivorDeps {
  sendState(sid: string, state: SurvivorState): void;
  profile(id: string): SurvivorProfile;
  saveProfiles(): void;
  users(sid: string): Participant[];
  avatars(sid: string): Map<string, AvatarState>;
  profileUpdated(id: string, profile: SurvivorProfile): void;
}

function send(sid: string, s: SurvivorState, d: SurvivorDeps) { d.sendState(sid, structuredClone(s)); }
function positionOf(u: Participant, avatars: Map<string, AvatarState>) {
  return u.mode === '3d' ? avatars.get(u.id) ?? SPAWN : u.pos ?? SPAWN;
}
const inJoinArea = (p: { x: number; z: number }) => survivorDistance(p, SURVIVOR_JOIN) <= SURVIVOR_JOIN.r;
const hasPendingChoice = (s: SurvivorState) => Object.values(s.players).some((p) => p.alive && p.choiceQueue.length > 0);
function random(s: SurvivorState) {
  let x = s.randomSeed | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  s.randomSeed = x >>> 0 || 1;
  return s.randomSeed / 0x1_0000_0000;
}
function pointSegmentDistance(point: { x: number; z: number }, from: { x: number; z: number }, to: { x: number; z: number }) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq)) : 0;
  return Math.hypot(point.x - (from.x + t * dx), point.z - (from.z + t * dz));
}
function pickedStyle(s: SurvivorState, id: string): SurvivorStyle { return s.stylePicks[id] ?? 'bloodrose'; }
function playerFor(u: Participant, s: SurvivorState, d: SurvivorDeps, index: number): SurvivorPlayer {
  const profile = d.profile(u.id);
  const style = pickedStyle(s, u.id);
  const def = SURVIVOR_STYLES[style];
  const a = index * 2.39996;
  const pos = clampSurvivorPosition(Math.sin(a) * 0.55, Math.cos(a) * 0.55);
  const maxHp = def.hp + profile.upgrades.vitality * 10;
  const player: SurvivorPlayer = {
    id: u.id, name: u.name, style, ...pos, hp: maxHp, maxHp, level: 1, xp: 0, nextXp: survivorXpFor(1),
    alive: true, kills: 0, gear: { [def.weapon]: 1 }, choiceQueue: [], hitAt: 0, attackAt: {}, moveAt: Date.now(),
  };
  discover(u.id, def.weapon, d);
  d.saveProfiles();
  return player;
}
function eligibleUsers(sid: string, d: SurvivorDeps) {
  const avatars = d.avatars(sid);
  return d.users(sid).filter((u) => inJoinArea(positionOf(u, avatars)));
}
function addPlayer(sid: string, s: SurvivorState, u: Participant, d: SurvivorDeps) {
  if (s.players[u.id]) return false;
  const player = playerFor(u, s, d, Object.keys(s.players).length);
  // 途中参加者は現在時刻・敵の強さはそのまま、レベル1で入る。
  if (s.phase !== 'lobby' && s.startedAt) player.xp = 0;
  s.players[u.id] = player;
  return true;
}

export function chooseSurvivorStyle(sid: string, user: Participant, style: SurvivorStyle, d: SurvivorDeps) {
  if (!SURVIVOR_STYLES[style]) return;
  const s = survivorOf(sid);
  if (s.phase !== 'lobby' && !inJoinArea(positionOf(user, d.avatars(sid)))) return;
  s.stylePicks[user.id] = style;
  send(sid, s, d);
}

export function startSurvivor(sid: string, by: Participant, d: SurvivorDeps) {
  const s = survivorOf(sid);
  if (s.phase === 'running' || s.phase === 'boss') {
    const u = d.users(sid).find((x) => x.id === by.id);
    if (u && inJoinArea(positionOf(u, d.avatars(sid)))) {
      if (addPlayer(sid, s, u, d)) send(sid, s, d);
    }
    return;
  }
  const group = eligibleUsers(sid, d);
  if (!group.some((u) => u.id === by.id)) return;
  const next = newSurvivorState();
  next.run = s.run + 1;
  next.phase = 'running';
  next.startedAt = Date.now();
  next.nextSpawnAt = next.startedAt + 500;
  next.randomSeed = (Math.random() * 0xffff_ffff) >>> 0 || 1;
  next.stylePicks = { ...s.stylePicks };
  group.forEach((u, i) => { next.players[u.id] = playerFor(u, next, d, i); });
  states.set(sid, next);
  send(sid, next, d);
}

export function moveSurvivor(sid: string, user: Participant, x: number, z: number, d: SurvivorDeps) {
  const s = survivorOf(sid), p = s.players[user.id];
  if (!p?.alive || s.pausedAt != null || hasPendingChoice(s) || !Number.isFinite(x) || !Number.isFinite(z) || (s.phase !== 'running' && s.phase !== 'boss')) return;
  const now = Date.now();
  const dt = Math.max(0.04, Math.min(0.4, (now - (p.moveAt ?? now - 100)) / 1000));
  const speed = SURVIVOR_MOVE_SPEED * (1 + d.profile(user.id).upgrades.haste * 0.03) * (1 + (p.gear.nightcloak ?? 0) * 0.025);
  const max = speed * dt + 0.35;
  const dx = x - p.x, dz = z - p.z, dist = Math.hypot(dx, dz);
  if (dist > max) { x = p.x + dx / dist * max; z = p.z + dz / dist * max; }
  Object.assign(p, clampSurvivorPosition(x, z), { moveAt: now });
  send(sid, s, d);
}

function poolFor(p: SurvivorPlayer) {
  return Object.values(SURVIVOR_GEAR).filter((g) => {
    if (g.rarity === 'mythic' && !g.evolvedFrom) return false;
    const level = p.gear[g.id] ?? 0;
    if (level >= g.maxLevel) return false;
    if (g.evolvedFrom) {
      const [weapon, passive] = g.evolvedFrom;
      return (p.gear[weapon] ?? 0) >= 5 && (p.gear[passive] ?? 0) >= 1;
    }
    return true;
  }).map((g) => g.id);
}
function giveXp(s: SurvivorState, d: SurvivorDeps, amount: number) {
  for (const p of Object.values(s.players)) {
    if (!p.alive) continue;
    p.xp += amount * (1 + (p.gear.soulcrown ?? 0) * 0.08);
    while (p.xp >= p.nextXp) {
      p.xp -= p.nextXp;
      p.level++;
      p.nextXp = survivorXpFor(p.level);
      const pool = poolFor(p);
      const choices: string[] = [];
      while (pool.length && choices.length < 3) choices.push(pool.splice(Math.floor(random(s) * pool.length), 1)[0]);
      if (choices.length) p.choiceQueue.push(choices);
    }
  }
}
function discover(id: string, gear: string, d: SurvivorDeps) {
  const profile = d.profile(id);
  if (!profile.discovered.includes(gear)) {
    profile.discovered.push(gear);
  }
  if (SURVIVOR_GEAR[gear]?.rarity === 'mythic' && !profile.achievements.includes('mythic')) profile.achievements.push('mythic');
  d.profileUpdated(id, profile);
}
export function chooseSurvivorGear(sid: string, user: Participant, gear: string, d: SurvivorDeps) {
  const s = survivorOf(sid), p = s.players[user.id];
  const choices = p?.choiceQueue[0];
  if (!p?.alive || !choices?.includes(gear)) return;
  const def = SURVIVOR_GEAR[gear];
  if (!def) return;
  if (def.evolvedFrom) {
    const [weapon] = def.evolvedFrom;
    p.gear[weapon] = 0;
  }
  const oldLevel = p.gear[gear] ?? 0;
  p.gear[gear] = Math.min(def.maxLevel, oldLevel + 1);
  if (gear === 'ironheart' && p.gear[gear] > oldLevel) {
    p.maxHp += 8;
    p.hp = Math.min(p.maxHp, p.hp + 8);
  }
  p.choiceQueue.shift();
  discover(user.id, gear, d);
  d.saveProfiles();
  send(sid, s, d);
}

function createEnemy(s: SurvivorState, kind: SurvivorEnemy['kind'], now: number): SurvivorEnemy {
  const a = random(s) * Math.PI * 2;
  const r = SURVIVOR_WORLD_LIMIT - (kind === 'boss' ? 1.5 : 0.75);
  const scale = 1 + Math.max(0, now - s.startedAt) / SURVIVOR_DURATION_MS * 1.8;
  const base = kind === 'ghoul' ? { hp: 18, speed: 1.15, damage: 7, xp: 2, radius: 0.32 }
    : kind === 'bat' ? { hp: 10, speed: 2.0, damage: 5, xp: 2, radius: 0.25 }
    : kind === 'knight' ? { hp: 55, speed: 0.72, damage: 14, xp: 5, radius: 0.42 }
    : { hp: 34_000, speed: 1.05, damage: 28, xp: 0, radius: 1.25 };
  const hp = kind === 'boss' ? base.hp : Math.round(base.hp * scale);
  return {
    id: `e${s.run}-${++s.spawnIndex}`, kind, x: Math.cos(a) * r, z: Math.sin(a) * r,
    hp, maxHp: hp, speed: base.speed * (kind === 'boss' ? 1 : Math.min(1.8, scale)), damage: base.damage, xp: base.xp, radius: base.radius,
    hitAt: 0, attackAt: now, nextSpecialAt: kind === 'boss' ? now + 5_000 : 0, dashFrom: null, dashUntil: 0,
  };
}
function weaponAttack(s: SurvivorState, p: SurvivorPlayer, gear: string, level: number, now: number, d: SurvivorDeps) {
  const profile = d.profile(p.id);
  const styleHaste = p.style === 'stargazer' ? 0.9 : 1;
  const passiveHaste = Math.max(0.5, (1 - (p.gear.astralbook ?? 0) * 0.07) * styleHaste);
  const configs: Record<string, { interval: number; range: number; damage: number; aoe?: number; targets?: number }> = {
    moonblade: { interval: 650, range: 2.3, damage: 16, targets: 1 },
    starbolt: { interval: 1050, range: 8.5, damage: 15, targets: 1 },
    shade: { interval: 1200, range: 7, damage: 17, targets: 3 },
    bloodaura: { interval: 650, range: 2.7, damage: 11, aoe: 2.7 },
    eclipse: { interval: 420, range: 3.2, damage: 30, aoe: 3.2 },
    starfall: { interval: 1000, range: 9.5, damage: 35, aoe: 2.8 },
    umbralstorm: { interval: 850, range: 8.2, damage: 27, targets: 8 },
    crimsonsun: { interval: 500, range: 3.7, damage: 19, aoe: 3.7 },
  };
  const cfg = configs[gear];
  if (!cfg || now < (p.attackAt[gear] ?? 0) + cfg.interval * passiveHaste) return;
  p.attackAt[gear] = now;
  const targets = s.enemies.filter((e) => e.hp > 0 && survivorDistance(e, p) <= cfg.range).sort((a, b) => survivorDistance(a, p) - survivorDistance(b, p));
  if (!targets.length) return;
  const raw = cfg.damage * (1 + (level - 1) * 0.18 + profile.upgrades.might * 0.05);
  const chosen = cfg.aoe ? targets.filter((e) => survivorDistance(e, targets[0]) <= cfg.aoe!) : targets.slice(0, cfg.targets ?? 1);
  if (chosen.length) {
    s.effects.push({
      id: `${s.run}-${p.id}-${gear}-${now}`,
      playerId: p.id,
      gear,
      at: now,
      from: { x: p.x, z: p.z },
      targets: chosen.map((e) => ({ x: e.x, z: e.z })),
      reach: Math.max(...chosen.map((e) => survivorDistance(p, e))),
    });
  }
  for (const e of chosen) {
    if (e.hp <= 0) continue;
    e.hp -= raw;
    e.hitAt = now;
    if (e.hp <= 0) {
      p.kills++;
      s.kills++;
      if (e.kind === 'boss') s.bossDefeated = true;
      else giveXp(s, d, e.xp);
    }
  }
}

function addAchievement(profile: SurvivorProfile, id: SurvivorAchievement) {
  if (!profile.achievements.includes(id)) profile.achievements.push(id);
}
function finish(sid: string, s: SurvivorState, d: SurvivorDeps, now: number) {
  if (s.phase === 'ended') return;
  s.phase = 'ended'; s.endedAt = now;
  s.pausedAt = null;
  for (const p of Object.values(s.players)) {
    const profile = d.profile(p.id);
    profile.points += p.level;
    profile.runs++;
    profile.bestLevel = Math.max(profile.bestLevel, p.level);
    profile.bestKills = Math.max(profile.bestKills, p.kills);
    addAchievement(profile, 'firstNight');
    if (p.level >= 10) addAchievement(profile, 'level10');
    if (p.level >= 25) addAchievement(profile, 'level25');
    if (s.bossDefeated) addAchievement(profile, 'boss');
    d.profileUpdated(p.id, profile);
  }
  d.saveProfiles();
  send(sid, s, d);
}

/** Called by the server on a fixed interval; the run state is authoritative. */
export function tickSurvivors(now: number, d: SurvivorDeps) {
  for (const [sid, s] of states) {
    if (s.phase !== 'running' && s.phase !== 'boss') continue;
    if (s.pausedAt != null) {
      if (hasPendingChoice(s)) continue;
      const pausedFor = Math.max(0, now - s.pausedAt);
      s.startedAt += pausedFor;
      s.nextSpawnAt += pausedFor;
      for (const p of Object.values(s.players)) {
        p.moveAt += pausedFor;
        if (p.hitAt > 0) p.hitAt += pausedFor;
        for (const gear of Object.keys(p.attackAt)) p.attackAt[gear] += pausedFor;
      }
      for (const enemy of s.enemies) {
        enemy.attackAt += pausedFor;
        if (enemy.hitAt > 0) enemy.hitAt += pausedFor;
        if (enemy.nextSpecialAt > 0) enemy.nextSpecialAt += pausedFor;
        if (enemy.dashUntil > 0) enemy.dashUntil += pausedFor;
      }
      for (const projectile of s.projectiles) projectile.expiresAt += pausedFor;
      s.pausedAt = null;
    } else if (hasPendingChoice(s)) {
      s.pausedAt = now;
      send(sid, s, d);
      continue;
    }
    s.effects = s.effects.filter((effect) => now - effect.at <= 900);
    const users = d.users(sid), avatars = d.avatars(sid);
    const elapsed = now - s.startedAt;
    if (elapsed >= SURVIVOR_DURATION_MS && s.phase === 'running') {
      s.phase = 'boss';
      s.enemies.push(createEnemy(s, 'boss', now));
      s.bossesSpawned = 1;
    }
    if (s.phase === 'boss') {
      while (elapsed >= SURVIVOR_DURATION_MS + s.bossesSpawned * 30_000) {
        s.enemies.push(createEnemy(s, 'boss', now));
        s.bossesSpawned++;
      }
    }
    for (const p of Object.values(s.players)) {
      if (!p.alive) continue;
      const u = users.find((x) => x.id === p.id);
      if (u?.mode === '3d') {
        const avatar = avatars.get(p.id);
        if (avatar) Object.assign(p, clampSurvivorPosition(avatar.x, avatar.z));
      }
    }
    const alive = Object.values(s.players).filter((p) => p.alive);
    if (!alive.length) { finish(sid, s, d, now); continue; }
    const lastDamagedAt = Object.values(s.players).reduce((latest, player) => Math.max(latest, player.hitAt), s.startedAt);
    const noDamageSteps = Math.min(4, Math.floor(Math.max(0, now - lastDamagedAt) / 30_000));
    if (now >= s.nextSpawnAt && s.enemies.length < SURVIVOR_MAX_ENEMIES) {
      const seconds = elapsed / 1000;
      const count = Math.min(4, (seconds > 300 ? 2 : 1) + Math.floor(noDamageSteps / 2));
      for (let i = 0; i < count && s.enemies.length < SURVIVOR_MAX_ENEMIES; i++) {
        const roll = random(s);
        const kind = seconds > 240 && roll < 0.26 ? 'knight' : seconds > 90 && roll < 0.56 ? 'bat' : 'ghoul';
        s.enemies.push(createEnemy(s, kind, now));
      }
      s.nextSpawnAt = now + Math.max(650, 1050 - seconds * 1.2 - noDamageSteps * 60);
    }
    const damageTargets: SurvivorPlayer[] = [];
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const targets = alive.filter((p) => p.alive).sort((a, b) => survivorDistance(a, e) - survivorDistance(b, e));
      const target = targets[0];
      if (!target) continue;
      if (e.kind === 'boss' && now >= e.nextSpecialAt) {
        const dx = target.x - e.x, dz = target.z - e.z;
        const distance = Math.hypot(dx, dz) || 1;
        const from = { x: e.x, z: e.z };
        const landing = clampSurvivorPosition(target.x - dx / distance * 0.9, target.z - dz / distance * 0.9);
        e.dashFrom = from;
        e.x = landing.x; e.z = landing.z;
        e.dashUntil = now + 520;
        e.nextSpecialAt = now + 5_000;
        e.attackAt = now;
        const armor = Math.min(0.4, (target.gear.ironheart ?? 0) * 0.06);
        target.hp -= e.damage * 2.4 * (1 - armor);
        target.hitAt = now;
        damageTargets.push(target);
        if (target.hp <= 0) { target.hp = 0; target.alive = false; }
        const volleySize = 16;
        const angleOffset = random(s) * Math.PI * 2;
        for (let i = 0; i < volleySize; i++) {
          const angle = angleOffset + i * Math.PI * 2 / volleySize;
          const speed = 5.8;
          s.projectiles.push({
            id: `${e.id}-bullet-${now}-${i}`, sourceId: e.id, x: e.x, z: e.z,
            vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed,
            damage: 23, radius: 0.2, expiresAt: now + 5_000,
          });
        }
      }
      const dist = survivorDistance(target, e);
      if (dist > e.radius + 0.42) {
        const step = Math.min(e.speed * SURVIVOR_TICK_MS / 1000, dist);
        e.x += (target.x - e.x) / dist * step;
        e.z += (target.z - e.z) / dist * step;
      } else if (now >= e.attackAt + 850 && now >= target.hitAt + Math.max(250, 550 - (target.gear.nightcloak ?? 0) * 60)) {
        const armor = Math.min(0.4, (target.gear.ironheart ?? 0) * 0.06);
        target.hp -= e.damage * (1 - armor);
        target.hitAt = e.attackAt = now;
        damageTargets.push(target);
        if (target.hp <= 0) { target.hp = 0; target.alive = false; }
      }
    }
    const remainingProjectiles: typeof s.projectiles = [];
    for (const projectile of s.projectiles) {
      if (now >= projectile.expiresAt) continue;
      const next = { x: projectile.x + projectile.vx * SURVIVOR_TICK_MS / 1000, z: projectile.z + projectile.vz * SURVIVOR_TICK_MS / 1000 };
      const target = alive.find((player) => player.alive && pointSegmentDistance(player, projectile, next) <= projectile.radius + 0.42);
      if (target) {
        const hitCooldown = Math.max(250, 550 - (target.gear.nightcloak ?? 0) * 60);
        if (now >= target.hitAt + hitCooldown) {
          const armor = Math.min(0.4, (target.gear.ironheart ?? 0) * 0.06);
          target.hp -= projectile.damage * (1 - armor);
          target.hitAt = now;
          damageTargets.push(target);
          if (target.hp <= 0) { target.hp = 0; target.alive = false; }
        }
        continue;
      }
      if (Math.abs(next.x) > SURVIVOR_WORLD_LIMIT + 0.5 || Math.abs(next.z) > SURVIVOR_WORLD_LIMIT + 0.5) continue;
      remainingProjectiles.push({ ...projectile, ...next });
    }
    s.projectiles = remainingProjectiles;
    if (damageTargets.length) {
      s.nextSpawnAt = Math.max(s.nextSpawnAt, now + 1_050);
      const minions = s.enemies.filter((enemy) => enemy.kind !== 'boss');
      const perHit = Math.min(5, Math.max(1, Math.ceil(minions.length * 0.08)));
      const removeCount = Math.min(minions.length, perHit * damageTargets.length);
      const nearestDamage = (enemy: SurvivorEnemy) => Math.min(...damageTargets.map((target) => survivorDistance(enemy, target)));
      const retreating = new Set(minions.sort((a, b) => nearestDamage(a) - nearestDamage(b)).slice(0, removeCount));
      s.enemies = s.enemies.filter((enemy) => !retreating.has(enemy));
    }
    for (const p of alive) if (p.alive) for (const [id, level] of Object.entries(p.gear)) if (level > 0 && SURVIVOR_GEAR[id]?.kind === 'weapon') weaponAttack(s, p, id, level, now, d);
    s.enemies = s.enemies.filter((e) => e.hp > 0);
    if (s.bossDefeated || !Object.values(s.players).some((p) => p.alive)) { finish(sid, s, d, now); continue; }
    if (hasPendingChoice(s)) {
      s.pausedAt = now;
    }
    send(sid, s, d);
  }
}

export function upgradeSurvivor(sid: string, id: string, upgrade: SurvivorMetaUpgrade, d: SurvivorDeps) {
  const def = SURVIVOR_META_UPGRADES[upgrade];
  if (!def) return;
  const profile = d.profile(id);
  if (profile.points < def.cost || profile.upgrades[upgrade] >= def.max) return;
  profile.points -= def.cost;
  profile.upgrades[upgrade]++;
  const s = states.get(sid), player = s?.players[id];
  if (upgrade === 'vitality' && player?.alive && s && (s.phase === 'running' || s.phase === 'boss')) {
    player.maxHp += 10;
    player.hp = Math.min(player.maxHp, player.hp + 10);
    send(sid, s, d);
  }
  d.saveProfiles();
  d.profileUpdated(id, profile);
}

export function resetSurvivorUpgrades(sid: string, id: string, d: SurvivorDeps) {
  const s = states.get(sid);
  if (s && (s.phase === 'running' || s.phase === 'boss')) return;
  const profile = d.profile(id);
  const refund = profile.upgrades.might * SURVIVOR_META_UPGRADES.might.cost
    + profile.upgrades.vitality * SURVIVOR_META_UPGRADES.vitality.cost
    + profile.upgrades.haste * SURVIVOR_META_UPGRADES.haste.cost;
  if (refund <= 0) return;
  profile.upgrades = { might: 0, vitality: 0, haste: 0 };
  profile.points += refund;
  d.saveProfiles();
  d.profileUpdated(id, profile);
}

export function removeSurvivor(sid: string, id: string, d: SurvivorDeps) {
  const s = states.get(sid), p = s?.players[id];
  if (!s || !p || !p.alive || (s.phase !== 'running' && s.phase !== 'boss')) return;
  p.alive = false; p.hp = 0;
  if (!Object.values(s.players).some((x) => x.alive)) finish(sid, s, d, Date.now());
  else send(sid, s, d);
}

