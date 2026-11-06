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
// P2-15: DinePOS servers that answered on this network: one press instead of typing an address
const found = (() => {
  try {
    return JSON.parse(q.get('found') || '[]');
  } catch {
    return [];
  }
})();
if (Array.isArray(found) && found.length) {
  const list = document.getElementById('foundList');
  for (const f of found) {
    if (!f || typeof f.url !== 'string' || !/^http:\/\/[0-9.]+:\d+$/.test(f.url)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    const title = document.createElement('span');
    title.textContent = f.name || 'DinePOS server';
    const where = document.createElement('small');
    where.textContent = [f.host, f.url.replace(/^http:\/\//, '')].filter(Boolean).join(' · ');
    b.append(title, where);
    b.addEventListener('click', () => {
      const autostart = document.getElementById('autostart').checked ? '1' : '0';
      location.href = `connect?${new URLSearchParams({ server: f.url, autostart }).toString()}`;
    });
    list.append(b);
  }
  if (list.childElementCount) document.getElementById('found').hidden = false;
}
if (!server.value && document.getElementById('found').hidden) server.focus();
