import { ELEVATOR_CLOSE_MS, ELEVATOR_DWELL_MS, MANSION_STOPS, NEW_ELEVATOR, elevatorArriveAt, type ElevatorState } from '../shared/city.ts';

/** 街のマンションのエレベーター。セッションごとに 1 台で、押された階を順に回る */
const elevators = new Map<string, ElevatorState>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const elevatorOf = (sid: string) => elevators.get(sid) ?? NEW_ELEVATOR;

function depart(sid: string, e: ElevatorState, to: number, now: number, send: (e: ElevatorState) => void) {
  const next: ElevatorState = { from: e.to, to, startAt: now + ELEVATOR_CLOSE_MS, queue: e.queue.filter((f) => f !== to) };
  elevators.set(sid, next);
  send(next);
  schedule(sid, send);
}

/** 着いてドアを開けたまま少し待ってから、次に押されている階へ */
function schedule(sid: string, send: (e: ElevatorState) => void) {
  clearTimeout(timers.get(sid));
  const e = elevatorOf(sid);
  if (!e.queue.length) return;
  const at = Math.max(elevatorArriveAt(e) + ELEVATOR_DWELL_MS, Date.now());
  timers.set(sid, setTimeout(() => {
    const cur = elevatorOf(sid);
    if (cur.queue.length) depart(sid, cur, cur.queue[0], Date.now(), send);
  }, at - Date.now()));
}

export function callElevator(sid: string, floor: number, send: (e: ElevatorState) => void) {
  if (!Number.isInteger(floor) || floor < 0 || floor >= MANSION_STOPS) return;
  const e = elevatorOf(sid);
  const now = Date.now();
  const idle = now >= elevatorArriveAt(e) && !e.queue.length;
  if (idle && e.to === floor) return;
  if (idle) { depart(sid, e, floor, now, send); return; }
  if (e.to === floor || e.queue.includes(floor)) return;
  const next = { ...e, queue: [...e.queue, floor] };
  elevators.set(sid, next);
  send(next);
  schedule(sid, send);
}

/** ワールドを切り替えたら 1 階に戻す */
export function resetElevator(sid: string) {
  clearTimeout(timers.get(sid));
  timers.delete(sid);
  elevators.delete(sid);
}
