// DinePOS Kitchen: the kitchen display (served by the outlet server at /kds) in its own full-screen window, for a
// kitchen PC. Asks for the server address once, remembers it (and the KDS pairing, which the page keeps itself),
// keeps the screen awake, starts with Windows, and reconnects by itself when the server is not there yet.
// The window may show only the server's own pages and this app's setup page; it never opens the database.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, powerSaveBlocker, protocol, session } from 'electron';
import { kdsUrl, mayOpen, normalizeServerUrl, parseConfig, type KitchenConfig } from './config.js';

const SCHEME = 'dinepos-kitchen';
const SETUP = `${SCHEME}://app/setup.html`;
const here = path.dirname(fileURLToPath(import.meta.url));
const SETUP_DIR = path.join(here, '..', 'setup');
const FILES: Record<string, string> = { '/setup.html': 'text/html; charset=utf-8', '/setup.css': 'text/css; charset=utf-8', '/setup.js': 'text/javascript; charset=utf-8' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
if (process.env.DINEPOS_KITCHEN_USER_DATA_DIR) app.setPath('userData', process.env.DINEPOS_KITCHEN_USER_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();

const configFile = () => path.join(app.getPath('userData'), 'kitchen.json');
function readConfig(): KitchenConfig {
  try {
    return parseConfig(readFileSync(configFile(), 'utf8'));
  } catch {
    return parseConfig(null);
  }
}
function saveConfig(c: KitchenConfig): void {
  writeFileSync(configFile(), JSON.stringify(c, null, 2));
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: c.autoStart });
}

let win: BrowserWindow | null = null;
let config = readConfig();

/** The setup page; `problem` is shown, and with a saved server it tries again by itself. */
function showSetup(problem?: string): void {
  const q = new URLSearchParams({ ...(config.serverUrl ? { server: config.serverUrl } : {}), autostart: config.autoStart ? '1' : '0', ...(problem ? { problem } : {}) });
  void win?.loadURL(`${SETUP}?${q.toString()}`);
}

async function reachable(serverUrl: string): Promise<string | null> {
  try {
    const r = await fetch(`${serverUrl}/v1/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return `The server at ${serverUrl} answered ${r.status}.`;
    const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
    return j && typeof j === 'object' ? null : `${serverUrl} is not a DinePOS server.`;
  } catch {
    return `Cannot reach the DinePOS server at ${serverUrl}. Is the main PC on, with “DinePOS Server” open, and is this PC on the same network?`;
  }
}

/** Opens the kitchen display, or the setup page saying why it cannot. */
async function openDisplay(): Promise<void> {
  if (!config.serverUrl) return showSetup();
  const problem = await reachable(config.serverUrl);
  if (problem) return showSetup(problem);
  void win?.loadURL(kdsUrl(config.serverUrl));
}

/** dinepos-kitchen://app/… : the setup page's files, and its two actions (connect, retry). */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const html = (body: string) => new Response(`<!doctype html><meta charset="utf-8"><title>DinePOS Kitchen</title><body style="background:#0c0c0d;color:#ddd;font:20px system-ui;padding:40px">${body}`, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
  if (url.pathname === '/connect') {
    const server = normalizeServerUrl(url.searchParams.get('server') ?? '');
    const autoStart = url.searchParams.get('autostart') === '1';
    if (!server) {
      setTimeout(() => {
        config = { ...config, autoStart };
        showSetup('That is not a server address. Type it like 192.168.1.4 (shown on the main PC in Settings › Kitchen & printers).');
      }, 0);
      return html('Checking…');
    }
    const problem = await reachable(server);
    config = { serverUrl: problem ? config.serverUrl ?? server : server, autoStart };
    if (!problem) saveConfig(config);
    setTimeout(() => (problem ? showSetup(problem) : void win?.loadURL(kdsUrl(server))), 0);
    return html('Connecting…');
  }
  if (url.pathname === '/retry') {
    setTimeout(() => void openDisplay(), 0);
    return html('Connecting…');
  }
  const type = FILES[url.pathname];
  if (!type) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(path.join(SETUP_DIR, url.pathname.slice(1))), { headers: { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DinePOS Kitchen',
    backgroundColor: '#0c0c0d',
    kiosk: app.isPackaged, // full screen, no title bar; a development run keeps a normal window
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      autoplayPolicy: 'no-user-gesture-required', // the new-ticket chime plays with nobody touching the screen
    },
  });
  const wc = win.webContents;
  // only the server's pages and this app's setup page; nothing opens in a new window
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    const toSetup = url.startsWith(`${SCHEME}://`);
    // the setup page's actions only from the setup page itself (a server page may not change the saved server)
    if (toSetup ? !wc.getURL().startsWith(`${SCHEME}://`) : !mayOpen(url, config.serverUrl)) e.preventDefault();
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && mayOpen(url, config.serverUrl)) showSetup(`Lost the DinePOS server (${desc}).`);
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.control && input.shift && key === 'q') {
      e.preventDefault();
      app.quit();
    } else if (input.control && input.shift && key === 's') {
      e.preventDefault();
      showSetup();
    } else if (input.control && input.shift && key === 'm') {
      e.preventDefault();
      minimize();
    } else if (input.key === 'F5') {
      e.preventDefault();
      void openDisplay();
    }
  });
  // back from the taskbar: full screen again (a kiosk window cannot be minimized, so it leaves kiosk first)
  win.on('restore', () => {
    if (app.isPackaged && win && !win.isKiosk()) win.setKiosk(true);
  });
  win.on('closed', () => (win = null));
  void openDisplay();
}

/** Ctrl+Shift+M: out of the way (to the taskbar) without closing; tickets keep arriving and the chime still plays. */
function minimize(): void {
  if (!win) return;
  if (win.isKiosk()) win.setKiosk(false);
  win.minimize();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    if (app.isPackaged && !win.isKiosk()) win.setKiosk(true);
    win.focus();
  }
});

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); // no camera, mic, location…
  protocol.handle(SCHEME, handle);
  powerSaveBlocker.start('prevent-display-sleep'); // a kitchen screen stays on
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.autoStart });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
