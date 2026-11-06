// Electron main process for the DinePOS terminal. The renderer is a plain web page: no Node, no preload,
// sandboxed, may not navigate away or open windows. It talks to the outlet server over HTTP + WS; this
// process never opens the database (single-writer rule).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, protocol, session, shell, type MenuItemConstructorOptions } from 'electron';
import { CSP, isAppUrl, resolveAppFile, SCHEME, START_URL } from './protocol.js';
import { ADDON_FILES, loadAddonFile, parseAddonUrl } from './addons.js';
import { runServerMode } from './server-mode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(here, '..', 'dist-renderer');
/** Dev only: load the Vite dev server instead of the bundled renderer. */
const DEV_URL = process.env.DINEPOS_DEV_URL;
/** Optional: preselect the outlet server (installers, e2e tests). The user can change it in Settings. */
const SERVER_URL = process.env.DINEPOS_SERVER_URL;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Tests run the app in their own profile, so another copy (a dev window, the installed app) shares neither the
// single-instance lock nor the stored session.
/** `DinePOS.exe --server`: the DinePOS Server window on the master PC (server-mode.ts), not a billing terminal. */
const SERVER_MODE = process.argv.includes('--server');
if (process.env.DINEPOS_USER_DATA_DIR) app.setPath('userData', process.env.DINEPOS_USER_DATA_DIR);
// its own profile, so the server window and a billing window run side by side on the master PC
else if (SERVER_MODE) app.setPath('userData', path.join(app.getPath('appData'), 'DinePOS Server'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function startUrl(): string {
  const base = DEV_URL ?? START_URL;
  return SERVER_URL ? `${base}?server=${encodeURIComponent(SERVER_URL)}` : base;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'DinePOS',
    backgroundColor: '#f7f4ef',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(startUrl());
  return win;
}

async function serveApp(request: Request): Promise<Response> {
  // P5-01: an add-on's screens, fetched from the outlet server and run only once this terminal checked the signature
  const addon = isAppUrl(request.url) ? parseAddonUrl(request.url) : null;
  if (addon) {
    try {
      const bytes = await loadAddonFile(addon);
      return new Response(bytes, { headers: { 'content-type': ADDON_FILES[addon.file], 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' } });
    } catch (e) {
      console.warn(`add-on ${addon.id} screens refused: ${e instanceof Error ? e.message : String(e)}`);
      return new Response('Refused', { status: 403 });
    }
  }
  const hit = resolveAppFile(request.url, RENDERER_DIR);
  if (!hit) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(hit.file);
    return new Response(body, {
      headers: { 'content-type': hit.type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { id: 'new-window', label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (SERVER_MODE) return; // server-mode.ts shows its own window
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('web-contents-created', (_e, contents) => {
  const allowed = (url: string) => isAppUrl(url) || (DEV_URL !== undefined && url.startsWith(DEV_URL));
  contents.on('will-navigate', (e, url) => {
    if (!allowed(url)) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url); // help links only; never an in-app window
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

void app.whenReady().then(() => {
  // The POS needs no camera, microphone, location or notifications from the web layer.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  protocol.handle(SCHEME, serveApp);
  if (SERVER_MODE) return runServerMode(DEV_URL);
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (SERVER_MODE) return; // the server keeps running in the tray
  if (process.platform !== 'darwin') app.quit();
});
