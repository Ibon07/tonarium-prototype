// Device routing tests use synthetic browser objects; no physical media is opened.
import test from 'node:test';
import assert from 'node:assert/strict';

let serial = 0;
async function fixture(saved = {}) {
  const writes = new Map([['tonarium.audioDevices', JSON.stringify(saved)]]);
  const elements = [];
  let devices = [];
  class Target {
    id = ''; calls = []; state = 'running'; behavior;
    async setSinkId(id) { this.calls.push(id); await this.behavior?.(id); this.id = id; }
  }
  class Context extends Target {}
  class Media extends Target {}
  Object.assign(globalThis, {
    AudioContext: Context, HTMLMediaElement: Media,
    localStorage: { getItem: k => writes.get(k), setItem: (k, v) => writes.set(k, v) },
    document: { querySelectorAll: () => elements },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { enumerateDevices: async () => devices } } });
  const api = await import(`../src/audioDevices.ts?test=${++serial}`);
  return { api, elements, Media, writes, setDevices: value => { devices = value; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('saved input is constrained without capturing; input switch callback never enables mic', async () => {
  const { api } = await fixture({ input: 'mic-a' });
  assert.deepEqual(api.microphoneOptions(), { deviceId: { exact: 'mic-a' } });
  const calls = []; api.registerMicrophoneSwitcher(async id => { calls.push(id); });
  await api.setAudioDevices({ input: 'mic-b', output: '' });
  assert.deepEqual(calls, ['mic-b']);
  assert.deepEqual(api.audioDeviceSnapshot(), { input: 'mic-b', output: '' });
});

test('output routes existing/new contexts and media; returning to default clears sinks', async () => {
  const { api, Media, elements } = await fixture();
  const context = api.createAudioContext(); const media = new Media(); elements.push(media);
  await api.setAudioDevices({ input: '', output: 'speaker-a' });
  assert.equal(context.id, 'speaker-a'); assert.equal(media.id, 'speaker-a');
  const later = api.createAudioContext(); const laterMedia = new Media(); api.applyMediaOutput(laterMedia); elements.push(laterMedia); await settle();
  assert.equal(later.id, 'speaker-a'); assert.equal(laterMedia.id, 'speaker-a');
  await api.setAudioDevices({ input: '', output: '' });
  for (const target of [context, media, later, laterMedia]) assert.equal(target.id, '');
});

test('denied input preserves saved selection and reports error', async () => {
  const { api, writes } = await fixture({ input: 'mic-a', output: '' });
  api.registerMicrophoneSwitcher(async id => { if (id === 'denied') throw new Error('Permission denied'); });
  await assert.rejects(api.setAudioDevices({ input: 'denied', output: '' }), /Permission denied/);
  assert.deepEqual(api.audioDeviceSnapshot(), { input: 'mic-a', output: '' });
  assert.equal(JSON.parse(writes.get('tonarium.audioDevices')).input, 'mic-a');
  assert.match(api.audioDeviceError(), /Permission denied/);
});

test('hidden device enumeration does not discard saved preferences', async () => {
  const { api, setDevices } = await fixture({ input: 'mic-a', output: 'speaker-a' });
  setDevices([{ kind: 'audioinput', deviceId: '', label: '' }, { kind: 'audiooutput', deviceId: '', label: '' }]);
  await api.refreshAudioDevices();
  assert.deepEqual(api.audioDeviceSnapshot(), { input: 'mic-a', output: 'speaker-a' });
});

test('unplugged saved devices fall back to default when enumeration is exposed', async () => {
  const { api, setDevices } = await fixture({ input: 'gone-mic', output: 'gone-speaker' });
  const calls = []; api.registerMicrophoneSwitcher(async id => { calls.push(id); });
  setDevices([{ kind: 'audioinput', deviceId: 'mic-b', label: 'Other mic' }, { kind: 'audiooutput', deviceId: 'speaker-b', label: 'Other speaker' }]);
  await api.refreshAudioDevices();
  assert.deepEqual(api.audioDeviceSnapshot(), { input: '', output: '' });
  assert.deepEqual(calls, ['']); assert.match(api.audioDeviceError(), /既定/);
});

test('output failure waits for slow sinks before rollback, leaving every sink consistent', async () => {
  const { api, elements, Media } = await fixture();
  const slow = new Media(), denied = new Media(); elements.push(slow, denied);
  slow.behavior = async id => { if (id === 'speaker-a') await new Promise(resolve => setTimeout(resolve, 20)); };
  denied.behavior = async id => { if (id === 'speaker-a') throw new Error('Output denied'); };
  await assert.rejects(api.setAudioDevices({ input: '', output: 'speaker-a' }), /Output denied/);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(slow.id, '', 'late successful output selection must not overtake rollback');
  assert.equal(denied.id, ''); assert.equal(api.audioDeviceSnapshot().output, '');
});

test('closed contexts are ignored during an output change', async () => {
  const { api } = await fixture();
  const closed = api.createAudioContext(); closed.state = 'closed';
  closed.behavior = async () => { throw new Error('closed context should not receive sink request'); };
  await api.setAudioDevices({ input: '', output: 'speaker-a' });
  assert.deepEqual(closed.calls, []);
});

test('after enumeration was permitted, unplugging all audio devices clears stale preference', async () => {
  const { api, setDevices } = await fixture({ input: 'mic-a', output: 'speaker-a' });
  setDevices([{ kind: 'audioinput', deviceId: 'mic-a', label: 'Microphone' }, { kind: 'audiooutput', deviceId: 'speaker-a', label: 'Speakers' }]);
  await api.refreshAudioDevices(); setDevices([]); await api.refreshAudioDevices();
  assert.deepEqual(api.audioDeviceSnapshot(), { input: '', output: '' });
});

test('contexts/media created during an output change adopt the committed destination', async () => {
  const { api, elements, Media } = await fixture();
  const slow = new Media(); elements.push(slow);
  let release;
  slow.behavior = async id => { if (id === 'speaker-a') await new Promise(resolve => { release = resolve; }); };
  const change = api.setAudioDevices({ input: '', output: 'speaker-a' });
  await settle();
  const later = api.createAudioContext(); const laterMedia = new Media(); elements.push(laterMedia); api.applyMediaOutput(laterMedia);
  release(); await change; await settle();
  assert.equal(later.id, 'speaker-a'); assert.equal(laterMedia.id, 'speaker-a');
});

test('concurrent changes execute in order and persist the last selection', async () => {
  const { api, elements, Media, writes } = await fixture();
  const media = new Media(); elements.push(media);
  media.behavior = async id => { if (id === 'first') await new Promise(resolve => setTimeout(resolve, 15)); };
  await Promise.all([api.setAudioDevices({ input: '', output: 'first' }), api.setAudioDevices({ input: '', output: 'last' })]);
  assert.deepEqual(media.calls, ['first', 'last']); assert.equal(media.id, 'last');
  assert.equal(api.audioDeviceSnapshot().output, 'last'); assert.equal(JSON.parse(writes.get('tonarium.audioDevices')).output, 'last');
});
