const destination = 'https://ceo-knowledgeweb.autopilot-note.com/';
const status = document.querySelector('#status');

window.setTimeout(() => {
  if (status) status.textContent = '生成画面へ移動しています。';
  window.location.replace(destination);
}, 1200);
