window.tonariumShell.state().then(state => {
  document.getElementById('audio').textContent = state.audioIncluded ? 'この共有には PC 全体の再生音声も含まれます。' : '画面の映像のみ共有します。';
  for (const source of state.sources) {
    const button = document.createElement('button');
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = '';
    const label = document.createElement('span');
    label.textContent = source.name;
    button.append(image, label);
    button.addEventListener('click', () => window.tonariumShell.selectSource(source.id));
    document.getElementById('sources').append(button);
  }
});
document.getElementById('cancel').addEventListener('click', () => window.tonariumShell.selectSource(null));
