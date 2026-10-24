/** Device preferences shared by Web and Electron; no desktop-only media stack. */
export type AudioDevices = { input: string; output: string };
const key = 'tonarium.audioDevices';
function load(): AudioDevices {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '{}'); return { input: typeof v.input === 'string' ? v.input : '', output: typeof v.output === 'string' ? v.output : '' }; } catch { return { input: '', output: '' }; }
}
let selected = load();
const contexts = new Set<AudioContext>();
const listeners = new Set<() => void>();
let switchInput: ((id: string) => Promise<unknown>) | undefined;
let error = '';
let deviceNamesVisible = false;
let pendingChange: Promise<unknown> = Promise.resolve();
const emit = () => listeners.forEach((fn) => fn());
export const audioDeviceSnapshot = () => selected;
export const audioDeviceError = () => error;
export const subscribeAudioDevices = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const microphoneOptions = (): { deviceId?: { exact: string } } => selected.input ? { deviceId: { exact: selected.input } } : {};
export const registerMicrophoneSwitcher = (fn: (id: string) => Promise<unknown>) => { switchInput = fn; };
export const outputSelectionSupported = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype && 'setSinkId' in HTMLMediaElement.prototype;
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
async function sink(target: AudioContext | HTMLMediaElement, id: string) {
  if (target instanceof AudioContext && target.state === 'closed') { contexts.delete(target); return; }
  const api = target as SinkContext;
  if (api.setSinkId) await api.setSinkId(id);
  else if (id) throw new Error('このブラウザは出力先の変更に対応していません');
}
function report(e: unknown) { error = e instanceof Error ? e.message : String(e); emit(); }
export function createAudioContext() {
  const context = new AudioContext(); contexts.add(context);
  void pendingChange.then(() => sink(context, selected.output)).catch(report);
  return context;
}
export function applyMediaOutput(element: HTMLMediaElement) { void pendingChange.then(() => sink(element, selected.output)).catch(report); }
async function applyOutput(id: string) {
  const results = await Promise.allSettled([...contexts, ...document.querySelectorAll<HTMLMediaElement>('audio,video')].map((target) => sink(target, id)));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
export function setAudioDevices(next: AudioDevices) {
  const result = pendingChange.then(() => changeAudioDevices(next));
  pendingChange = result.catch(() => {});
  return result;
}
async function changeAudioDevices(next: AudioDevices) {
  const previous = selected;
  try {
    if (next.input !== previous.input) await switchInput?.(next.input);
    if (next.output !== previous.output) await applyOutput(next.output);
    selected = { ...next }; error = '';
    try { localStorage.setItem(key, JSON.stringify(selected)); } catch { /* Session setting remains usable. */ }
    emit();
  } catch (e) {
    // A partially changed output must not silently disagree with the UI.
    await Promise.allSettled([switchInput?.(previous.input), applyOutput(previous.output)]);
    report(e); throw e;
  }
}
export async function refreshAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  // Hidden device IDs before permission are not evidence that a saved device disappeared.
  deviceNamesVisible ||= devices.some((d) => !!d.label);
  if (deviceNamesVisible) {
    const next = { ...selected };
    if (next.input && !devices.some((d) => d.kind === 'audioinput' && d.deviceId === next.input)) next.input = '';
    if (next.output && !devices.some((d) => d.kind === 'audiooutput' && d.deviceId === next.output)) next.output = '';
    if (next.input !== selected.input || next.output !== selected.output) { await setAudioDevices(next); error = '選択した機器が見つからないため、システムの既定に戻しました。'; emit(); }
  }
  return devices;
}
export function observeAudioDevices() {
  const changed = () => { void refreshAudioDevices().catch(report); };
  navigator.mediaDevices?.addEventListener('devicechange', changed);
  const observer = new MutationObserver((changes) => {
    for (const change of changes) for (const node of change.addedNodes) if (node instanceof Element) {
      if (node instanceof HTMLMediaElement) applyMediaOutput(node);
      node.querySelectorAll<HTMLMediaElement>('audio,video').forEach(applyMediaOutput);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  changed();
  return () => { observer.disconnect(); navigator.mediaDevices?.removeEventListener('devicechange', changed); };
}
export function openAudioSettings() { window.dispatchEvent(new Event('tonarium:audio-settings')); }
