// DinePOS Kitchen: the kitchen display (served by the outlet server at /kds) in its own full-screen window, for a
// kitchen PC. Asks for the server address once, remembers it (and the KDS pairing, which the page keeps itself),
// keeps the screen awake, starts with Windows, and reconnects by itself when the server is not there yet.
// P2-15: when the main PC gets a new IP address, finds the same server on the network and carries the pairing over.
// The window may show only the server's own pages and this app's setup page; it never opens the database.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, powerSaveBlocker, protocol, session } from 'electron';
import { CAPTURE_SCRIPT, forServer, kdsUrl, mayOpen, normalizeServerUrl, parseCaptured, parseConfig, seedScript, type KitchenConfig } from './config.js';
import { discoverServers, pickServer, type FoundServer } from './discovery.js';

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

/**
 * The setup page; `problem` is shown, and with a saved server it tries again by itself. P2-15: it also lists the
 * DinePOS servers that answered on this network, to pick one instead of typing an address.
 */
async function showSetup(problem?: string, found?: FoundServer[]): Promise<void> {
  const servers = (found ?? (await discoverServers())).map((f) => ({ url: f.url, name: f.name, host: f.host }));
  const q = new URLSearchParams({
    ...(config.serverUrl ? { server: config.serverUrl } : {}),
    autostart: config.autoStart ? '1' : '0',
    ...(problem ? { problem } : {}),
    ...(servers.length ? { found: JSON.stringify(servers.slice(0, 8)) } : {}),
  });
  await win?.loadURL(`${SETUP}?${q.toString()}`).catch(() => undefined);
}

type Check = { ok: true; serverId: string | null } | { ok: false; problem: string };

async function check(serverUrl: string): Promise<Check> {
  try {
    const r = await fetch(`${serverUrl}/v1/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, problem: `The server at ${serverUrl} answered ${r.status}.` };
    const j = (await r.json().catch(() => null)) as { serverId?: unknown } | null;
    if (!j || typeof j !== 'object') return { ok: false, problem: `${serverUrl} is not a DinePOS server.` };
    return { ok: true, serverId: typeof j.serverId === 'string' ? j.serverId : null };
  } catch {
    return { ok: false, problem: `Cannot reach the DinePOS server at ${serverUrl}. Is the main PC on, with “DinePOS Server” open, and is this PC on the same network?` };
  }
}

/** It answers, and it is the saved outlet (or one of them does not know its id yet). */
const isOurs = (c: Check): c is { ok: true; serverId: string | null } => c.ok && (!config.serverId || !c.serverId || c.serverId === config.serverId);

/** P2-15: the saved server at a new address (from what answered on the network), or null. */
async function findMoved(found: FoundServer[]): Promise<{ url: string; serverId: string | null } | null> {
  if (!config.serverId) return null;
  const url = pickServer(found, config.serverId, config.serverUrl);
  if (!url || url === config.serverUrl) return null;
  const c = await check(url);
  return isOurs(c) ? { url, serverId: c.serverId } : null;
}

/** Opens the kitchen display, or the setup page saying why it cannot. */
async function openDisplay(): Promise<void> {
  if (!config.serverUrl) return showSetup();
  const c = await check(config.serverUrl);
  if (isOurs(c)) return loadDisplay(config.serverUrl, c.serverId);
  // not there (or another outlet has that address now): the main PC may have a new address
  const found = await discoverServers();
  const moved = await findMoved(found);
  if (moved) return loadDisplay(moved.url, moved.serverId);
  return showSetup(c.ok ? `${config.serverUrl} is a different DinePOS outlet now. Choose this kitchen’s main PC.` : c.problem, found);
}

/**
 * Saves where the server is and opens the display there. When this screen has a pairing for that server, it goes
 * into the address's browser storage first (a page of the server, then the display), so a new address does not ask
 * to be paired again.
 */
async function loadDisplay(serverUrl: string, serverId: string | null): Promise<void> {
  const next = forServer(config, serverUrl, serverId);
  if (JSON.stringify(next) !== JSON.stringify(config)) saveConfig(next);
  config = next;
  misses = 0;
  if (!win) return;
  if (config.deviceToken || config.station) {
    try {
      await win.loadURL(`${serverUrl}/v1/health`);
      await win.webContents.executeJavaScript(seedScript(config));
    } catch {
      // the display then asks to be paired, as before P2-15
    }
  }
  await win.loadURL(kdsUrl(serverUrl)).catch(() => undefined);
}

/** Whether the window shows the saved server's display now. */
function showingDisplay(): boolean {
  if (!win || !config.serverUrl) return false;
  const url = win.webContents.getURL();
  return mayOpen(url, config.serverUrl) && new URL(url).pathname.startsWith('/kds');
}

/** P2-15: keeps a copy of the display's pairing and station (they change inside the page, e.g. when it is paired). */
async function capture(): Promise<void> {
  if (!showingDisplay()) return;
  const got = parseCaptured(await win!.webContents.executeJavaScript(CAPTURE_SCRIPT).catch(() => null));
  if (!got || !showingDisplay()) return;
  if (got.deviceToken === config.deviceToken && got.station === config.station) return;
  config = { ...config, deviceToken: got.deviceToken, station: got.station };
  saveConfig(config);
}

/**
 * P2-15: every 15 s while the display is up: copy the pairing; when the server has not answered twice in a row, look
 * for it on the network and follow it if it now has another address. (A server that is only restarting comes back at
 * the same address, and the display reconnects by itself, as before.)
 */
const WATCH_MS = 15_000;
let misses = 0;
let watching = false;
async function watch(): Promise<void> {
  if (watching || !showingDisplay()) return;
  watching = true;
  try {
    await capture();
    misses = isOurs(await check(config.serverUrl!)) ? 0 : misses + 1;
    if (misses < 2) return;
    const moved = await findMoved(await discoverServers());
    if (moved && showingDisplay()) await loadDisplay(moved.url, moved.serverId);
  } finally {
    watching = false;
  }
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
        void showSetup('That is not a server address. Type it like 192.168.1.4 (shown on the main PC in Settings › Kitchen & printers).');
      }, 0);
      return html('Checking…');
    }
    const c = await check(server);
    config = { ...config, autoStart };
    if (!c.ok) config = { ...config, serverUrl: config.serverUrl ?? server };
    // a different outlet's server starts again (new pairing); the same one keeps this screen's pairing
    setTimeout(() => void (c.ok ? loadDisplay(server, c.serverId) : showSetup(c.problem)), 0);
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
    if (isMainFrame && code !== -3 && mayOpen(url, config.serverUrl)) void showSetup(`Lost the DinePOS server (${desc}).`);
  });
  wc.on('did-finish-load', () => void capture());
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.control && input.shift && key === 'q') {
      e.preventDefault();
      app.quit();
    } else if (input.control && input.shift && key === 's') {
      e.preventDefault();
      void capture().finally(() => void showSetup());
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
  setInterval(() => void watch(), WATCH_MS);
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
