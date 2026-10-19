import { useEffect, useState } from 'react';
import { ROLL_MS, type DiceRoll, type DieSides } from '../../../shared/dice.ts';
import type { Item } from '../../../shared/items.ts';
import { useStore, get, set, save, serverNow } from '../store.ts';
import { itemAction } from './actions.ts';

export interface DiceSettings { sides: DieSides; count: number; secret: boolean }

/** 振る種類・個数は人ごとに手元へ保存する（3D でクリックしたときもこれで振る） */
export const useDiceSettings = () => useStore((s) => s.dice);
export function setDiceSettings(patch: Partial<DiceSettings>) {
  set((s) => {
    const dice = { ...s.dice, ...patch };
    save('tonarium.dice', dice);
    return { dice };
  });
}

export function rollDice(id: string) {
  const { sides, count, secret } = get().dice;
  itemAction(id, { a: 'diceRoll', sides, count, secret });
}

export const rollElapsed = (roll: DiceRoll) => serverNow() - roll.at;
export const isRolling = (roll: DiceRoll | null) => !!roll && rollElapsed(roll) < ROLL_MS;

/** 出た目。シークレットは本人宛てのチャットにだけ届くので、そこから探す。分からなければ null */
export function useRollResults(roll: DiceRoll | null) {
  return useStore((s) => {
    if (!roll) return null;
    if (roll.results) return roll.results;
    if (roll.by !== s.selfId || !s.session) return null;
    return s.chats[s.session]?.findLast((m) => m.dice?.id === roll.id)?.dice?.results ?? null;
  });
}

/** 転がっている間だけ描き直し続ける */
export function useRollTick(item: Item & { kind: 'dice' }) {
  const [, tick] = useState(0);
  const at = item.roll?.at;
  useEffect(() => {
    if (!item.roll || !isRolling(item.roll)) return;
    let raf = 0;
    const loop = () => {
      tick((n) => n + 1);
      if (item.roll && isRolling(item.roll)) raf = requestAnimationFrame(loop);
      else tick((n) => n + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [at]);
}
