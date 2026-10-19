import { DICE_COLORS, DICE_MAX, DICE_SIDES, ROLL_MS, diceLabel } from '../../../shared/dice.ts';
import type { Item } from '../../../shared/items.ts';
import { nameOf } from '../store.ts';
import { isRolling, rollDice, rollElapsed, setDiceSettings, useDiceSettings, useRollResults, useRollTick } from '../items/dice.ts';

/** 転がっている間に見せる目。全員だいたい同じものが見えるよう、経過時間から決める */
const flicker = (elapsed: number, i: number, sides: number) => ((Math.floor(elapsed / 80) * 7919 + i * 104729) % sides) + 1;

export function DiceBody({ item, interactive }: { item: Item & { kind: 'dice' }; interactive: boolean }) {
  const st = useDiceSettings();
  const results = useRollResults(item.roll);
  useRollTick(item);
  const roll = item.roll;
  const rolling = isRolling(roll);
  const elapsed = roll ? rollElapsed(roll) : 0;
  const total = results?.reduce((a, b) => a + b, 0);
  return (
    <div className="dicewin">
      <div className="dicetray" aria-live="polite">
        {roll
          ? Array.from({ length: roll.count }, (_, i) => (
            <span
              key={`${roll.id}-${i}`} className={`die2d d${roll.sides} ${rolling ? 'spin' : ''}`}
              style={{
                background: DICE_COLORS[roll.sides].bg, color: DICE_COLORS[roll.sides].ink,
                // 途中から開いた人も同じところから回って見えるよう、経過分だけ進めておく
                animationDuration: `${ROLL_MS - i * 60}ms`, animationDelay: `${-elapsed}ms`,
              }}
            >
              <b>{rolling ? flicker(elapsed, i, roll.sides) : results ? results[i] : '？'}</b>
            </span>
          ))
          : <span className="sub">まだ振っていません</span>}
      </div>
      <div className="dicesum">
        {!roll ? '種類と個数を選んで振ってください'
          : rolling ? `${nameOf(roll.by)} が ${diceLabel(roll.sides, roll.count)} を振っています…`
          : results ? <><b>{nameOf(roll.by)}</b>：{diceLabel(roll.sides, roll.count)} = <b className="dtotal">{total}</b>{roll.secret && <span className="sub">（シークレット・あなただけに見えています）</span>}</>
          : <><b>{nameOf(roll.by)}</b> がシークレットで {diceLabel(roll.sides, roll.count)} を振りました</>}
      </div>
      {interactive && (
        <>
          <div className="dicesides" role="radiogroup" aria-label="サイコロの種類">
            {DICE_SIDES.map((n) => (
              <button key={n} role="radio" aria-checked={st.sides === n} className={`ib dside ${st.sides === n ? 'on' : ''}`} onClick={() => setDiceSettings({ sides: n })}>d{n}</button>
            ))}
          </div>
          <div className="dicerow">
            <span className="dcount" role="group" aria-label="個数">
              <button className="ib" aria-label="減らす" disabled={st.count <= 1} onClick={() => setDiceSettings({ count: st.count - 1 })}>−</button>
              <b>{st.count}個</b>
              <button className="ib" aria-label="増やす" disabled={st.count >= DICE_MAX} onClick={() => setDiceSettings({ count: st.count + 1 })}>＋</button>
            </span>
            <label className="dsecret" title="結果は自分だけに見え、ほかの人には振ったことだけが伝わります">
              <input type="checkbox" checked={st.secret} onChange={(e) => setDiceSettings({ secret: e.target.checked })} />シークレット
            </label>
            <button className="primary droll" disabled={rolling} onClick={() => rollDice(item.id)}>{diceLabel(st.sides, st.count)} を振る</button>
          </div>
        </>
      )}
    </div>
  );
}
