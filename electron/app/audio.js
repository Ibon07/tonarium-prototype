const inputs = ['input', 'output'].map(id => document.getElementById(id));
const message = document.getElementById('message');
let selection = { input: '', output: '' };
let busy = false;
let outputSupported = true;
function render(state) {
  selection = { input: state.input || '', output: state.output || '' };
  outputSupported = state.outputSupported !== false;
  for (const select of inputs) {
    const value = selection[select.id];
    const options = [new Option('システムの既定', '')];
    for (const device of state.devices || []) if (device.kind === `audio${select.id}` && device.deviceId && device.deviceId !== 'default') options.push(new Option(device.label || `音声機器 ${options.length}`, device.deviceId));
    if (value && !options.some(o => o.value === value)) options.push(new Option('保存された機器（確認待ち）', value));
    select.replaceChildren(...options); select.value = value;
    select.disabled = select.id === 'output' && state.outputSupported === false;
  }
  message.textContent = state.error || state.notice || '';
}
async function run(action) {
  if (busy) return;
  busy = true;
  for (const control of document.querySelectorAll('select,button')) control.disabled = true;
  try { render(await action()); }
  catch (error) { message.textContent = error.message; for (const select of inputs) select.value = selection[select.id]; }
  finally { busy = false; for (const control of document.querySelectorAll('select,button')) control.disabled = control.id === 'output' && !outputSupported; }
}
for (const select of inputs) select.addEventListener('change', () => run(() => window.tonariumShell.audioApply({ ...selection, [select.id]: select.value })));
document.getElementById('permit').onclick = () => run(() => window.tonariumShell.audioPermit());
document.getElementById('refresh').onclick = () => run(() => window.tonariumShell.audioList());
document.getElementById('close').onclick = () => window.close();
window.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
void run(() => window.tonariumShell.audioList());
setInterval(() => { if (!busy && !inputs.includes(document.activeElement)) void run(() => window.tonariumShell.audioList()); }, 3000);
