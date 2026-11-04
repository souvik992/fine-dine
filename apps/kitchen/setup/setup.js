/* global document, location -- a browser page (the setup screen), not Node */
// The setup page: fills in what the app knows, and when the saved server could not be reached, tries again by itself.
const q = new URLSearchParams(location.search);
const server = document.getElementById('server');
server.value = q.get('server') ? q.get('server').replace(/^http:\/\//, '').replace(/:7420$/, '') : '';
document.getElementById('autostart').checked = q.get('autostart') !== '0';

const problem = q.get('problem');
if (problem) {
  document.getElementById('problem').hidden = false;
  document.getElementById('problemText').textContent = problem;
  if (q.get('server')) {
    // a server was saved: keep trying (the main PC may still be starting)
    let left = 10;
    let timer = 0;
    const tick = () => {
      document.getElementById('retryText').textContent = `Trying again in ${left} s…`;
      if (left-- <= 0) location.href = 'retry';
      else timer = setTimeout(tick, 1000);
    };
    tick();
    // typing a new address stops the retry
    server.addEventListener('input', () => {
      clearTimeout(timer);
      document.getElementById('retryText').textContent = '';
    });
  }
}
if (!server.value) server.focus();
