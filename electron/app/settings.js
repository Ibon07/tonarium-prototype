const message = document.getElementById('message');
const input = document.getElementById('server');
window.tonariumShell.state().then(state => {
  input.value = state.server;
  message.textContent = state.error || '';
  input.focus();
});
document.getElementById('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try { await window.tonariumShell.connect(input.value); } catch (error) { message.textContent = error.message; }
});
document.getElementById('retry').addEventListener('click', () => window.tonariumShell.retry().catch(error => { message.textContent = error.message; }));
