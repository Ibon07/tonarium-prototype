import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { audioDeviceError, audioDeviceSnapshot, observeAudioDevices, outputSelectionSupported, refreshAudioDevices, setAudioDevices, subscribeAudioDevices } from './audioDevices.ts';

export function AudioSettings() {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selection = useSyncExternalStore(subscribeAudioDevices, audioDeviceSnapshot);
  const deviceError = useSyncExternalStore(subscribeAudioDevices, audioDeviceError);
  const refresh = async () => { try { setDevices(await refreshAudioDevices()); } catch (e) { setError(String(e)); } };
  useEffect(() => {
    const stop = observeAudioDevices();
    const show = (event: Event) => { event.preventDefault(); setOpen(true); };
    window.addEventListener('tonarium:audio-settings', show);
    return () => { stop(); window.removeEventListener('tonarium:audio-settings', show); };
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const changed = () => { void refresh(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    window.addEventListener('keydown', escape);
    return () => { navigator.mediaDevices?.removeEventListener('devicechange', changed); window.removeEventListener('keydown', escape); };
  }, [open]);
  const permit = async () => {
    setBusy(true); setError('');
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((t) => t.stop()); await refresh(); }
    catch (e) { setError(`マイクの使用を許可できませんでした: ${String(e)}`); }
    finally { setBusy(false); }
  };
  const choose = async (kind: 'input' | 'output', id: string) => {
    setBusy(true); setError('');
    try { await setAudioDevices({ ...selection, [kind]: id }); } catch (e) { setError(`変更できませんでした: ${String(e)}`); } finally { setBusy(false); }
  };
  if (!open) return null;
  return createPortal(<div className="audio-settings-backdrop" onClick={() => setOpen(false)}>
    <section className="audio-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="audio-settings-title" onClick={(e) => e.stopPropagation()}>
      <h2 id="audio-settings-title">マイク・スピーカー</h2>
      <p>通話・録音のマイクと、音声の出力先を選びます。</p>
      <button onClick={() => void permit()} disabled={busy}>マイクを許可して機器名を表示</button>
      {(['input', 'output'] as const).map((kind) => <label key={kind} className="audio-device-field">{kind === 'input' ? 'マイク（入力）' : 'スピーカー（出力）'}
        <select value={selection[kind]} disabled={busy || (kind === 'output' && !outputSelectionSupported())} onChange={(e) => void choose(kind, e.target.value)}>
          <option value="">システムの既定</option>
          {devices.filter((d) => d.kind === `audio${kind}` && d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${kind === 'input' ? 'マイク' : 'スピーカー'} ${i + 1}`}</option>)}
          {selection[kind] && !devices.some((d) => d.deviceId === selection[kind]) && <option value={selection[kind]}>保存された機器（確認待ち）</option>}
        </select>
      </label>)}
      {!outputSelectionSupported() && <p>このブラウザでは出力先を変更できません。OS側で選択してください。</p>}
      <p className="sub">録音中のマイク変更は次の録音から反映します。YouTube埋め込みの出力先はOS側で選択してください。</p>
      {(error || deviceError) && <p role="alert">{error || deviceError}</p>}
      <button autoFocus onClick={() => setOpen(false)}>閉じる</button>
    </section>
  </div>, document.body);
}
