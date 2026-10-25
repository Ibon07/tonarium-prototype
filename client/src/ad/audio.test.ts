import assert from 'node:assert/strict';
import test from 'node:test';
import { AdSoundPlayer } from './audio.ts';

class Param {
  value = 0;
  values: number[] = [];
  setValueAtTime(value: number) { this.value = value; this.values.push(value); }
  linearRampToValueAtTime(value: number) { this.values.push(value); }
  exponentialRampToValueAtTime(value: number) { this.values.push(value); }
}
class Gain {
  gain = new Param();
  disconnected = false;
  connect(target: unknown) { return target; }
  disconnect() { this.disconnected = true; }
}
class Voice {
  frequency = new Param();
  type = 'sine';
  onended: (() => void) | null = null;
  disconnected = false;
  starts: number[] = [];
  stops: Array<number | undefined> = [];
  connect(target: unknown) { return target; }
  disconnect() { this.disconnected = true; }
  start(at: number) { this.starts.push(at); }
  stop(at?: number) { this.stops.push(at); }
}
class Context {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  voices: Voice[] = [];
  gains: Gain[] = [];
  resumes = 0;
  closed = false;
  createOscillator() { const voice = new Voice(); this.voices.push(voice); return voice; }
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
}

function fixture() {
  const context = new Context();
  let creations = 0;
  const player = new AdSoundPlayer(() => { creations++; return context as unknown as AudioContext; });
  return { player, context, creations: () => creations };
}

test('only a gesture unlock creates the audio context; no events are replayed later', () => {
  const { player, context, creations } = fixture();
  player.play({ kind: 'purchase', tier: 1 });
  player.production(1, 1, 0);
  assert.equal(creations(), 0);
  player.unlock();
  assert.equal(context.resumes, 1);
  assert.equal(context.voices.length, 0);
  player.play({ kind: 'purchase', tier: 1 });
  assert.equal(context.voices.length, 2);
  player.dispose();
});

test('purchase pitch follows the dimension and rapid operations keep at most 24 voices', () => {
  const { player, context } = fixture();
  player.unlock();
  player.play({ kind: 'purchase', tier: 1 });
  const firstPitch = context.voices[0].frequency.values[0];
  player.play({ kind: 'purchase', tier: 8 });
  assert.ok(context.voices[2].frequency.values[0] > firstPitch);
  for (let i = 0; i < 100; i++) {
    context.currentTime += 0.06;
    player.play({ kind: 'crunch' });
  }
  assert.equal(context.voices.filter((voice) => !voice.disconnected).length, 24);
  player.dispose();
});

test('muting cancels future notes immediately and does not queue muted events', () => {
  const { player, context } = fixture();
  player.unlock();
  player.play({ kind: 'crunch' });
  assert.ok(context.voices.some((voice) => voice.starts[0] > context.currentTime));
  player.setVolume(0);
  assert.ok(context.voices.every((voice) => voice.disconnected && voice.stops.includes(undefined)));
  assert.ok(context.gains.every((gain, i) => i === 0 || gain.disconnected));
  const count = context.voices.length;
  player.play({ kind: 'save' });
  player.production(10, 1, 0);
  player.setVolume(0.5);
  assert.equal(context.voices.length, count);
  assert.equal(context.gains[0].gain.value, 0.5);
  player.dispose();
});

test('leaving production range stops ambience while an operation can finish, and disposal cleans all nodes', () => {
  const { player, context } = fixture();
  player.unlock();
  player.play({ kind: 'save' });
  player.production(10, 0.5, 0);
  player.stopProduction();
  assert.ok(context.voices.slice(0, 2).every((voice) => !voice.disconnected));
  assert.ok(context.voices.slice(2).every((voice) => voice.disconnected));
  player.dispose();
  assert.ok(context.voices.every((voice) => voice.disconnected));
  assert.ok(context.gains.every((gain) => gain.disconnected));
  assert.equal(context.closed, true);
  player.unlock();
  player.play({ kind: 'save' });
  assert.equal(context.voices.length, 4);
});
