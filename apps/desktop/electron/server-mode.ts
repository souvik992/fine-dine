// DinePOS Server window (`DinePOS.exe --server`, the "DinePOS Server" shortcut on the master PC): runs the outlet server
// under a ServerSupervisor and shows it: status, addresses and QR codes for phones and kitchen screens, devices,
// printers, backups, the cloud and the live log. Closing the window keeps the server running (tray icon); Quit stops it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { ORIGIN } from './protocol.js';
import { ServerSupervisor, type ServerCommand } from './server-supervisor.js';

/** How to run the server: the installed bundle, or (development and tests) DINEPOS_SERVER_NODE / _ARGS / _CWD. */
export function serverCommand(env: NodeJS.ProcessEnv = process.env, resources = process.resourcesPath): ServerCommand {
  const port = Number(env.DINEPOS_PORT ?? 7420) || 7420;
  const dataDir = env.DATA_DIR ?? path.join(env.ProgramData ?? 'C:\\ProgramData', 'DinePOS');
  const clean: NodeJS.ProcessEnv = { ...env };
  delete clean.ELECTRON_RUN_AS_NODE;
  if (env.DINEPOS_SERVER_NODE) {
    return { node: env.DINEPOS_SERVER_NODE, args: JSON.parse(env.DINEPOS_SERVER_ARGS ?? '[]') as string[], cwd: env.DINEPOS_SERVER_CWD ?? process.cwd(), env: clean, port, dataDir };
  }
  const dir = path.join(resources, 'server');
  return { node: path.join(dir, 'node.exe'), args: [path.join(dir, 'server.mjs')], cwd: dir, env: { ...clean, NODE_ENV: 'production' }, port, dataDir };
}

/** A small round tray icon (green running, amber starting, red stopped), drawn here: no image file needed. */
function dot(rgb: [number, number, number]): Electron.NativeImage {
  const size = 32;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      const a = d <= 13 ? 255 : d <= 14.5 ? Math.round(255 * (14.5 - d) / 1.5) : 0;
      row.set([rgb[0], rgb[1], rgb[2], a], 1 + x * 4);
    }
    rows.push(row);
  }
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  return nativeImage.createFromBuffer(png);
}

/** Called once the app is ready (after the app:// pages are served). */
export function runServerMode(devUrl: string | undefined): void {
  const command = serverCommand();
  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  const icons = { running: dot([22, 163, 74]), starting: dot([217, 119, 6]), stopped: dot([185, 28, 28]) };
  const supervisor = new ServerSupervisor({
    command,
    onChange: () => {
      const phase = supervisor.snapshot().phase;
      tray?.setImage(phase === 'running' || phase === 'external' ? icons.running : phase === 'starting' || phase === 'stopping' ? icons.starting : icons.stopped);
      tray?.setToolTip(`DinePOS Server: ${phase}`);
    },
  });

  const show = () => {
    if (!win) {
      win = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 900,
        minHeight: 600,
        title: 'DinePOS Server',
        backgroundColor: '#f7f4ef',
        autoHideMenuBar: true,
        icon: icons.running,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: path.join(app.getAppPath(), 'dist-electron', 'server-preload.cjs'), devTools: !app.isPackaged },
      });
      win.setMenu(null);
      void win.loadURL(devUrl ? `${devUrl}/server.html` : `${ORIGIN}/server.html`);
      win.on('close', (e) => {
        if (quitting) return;
        e.preventDefault(); // the server keeps running; the tray icon brings the window back
        win?.hide();
      });
      win.on('closed', () => (win = null));
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const quit = async () => {
    const phase = supervisor.snapshot().phase;
    if (phase !== 'stopped' && phase !== 'external') {
      const r = await dialog.showMessageBox(win ?? undefined!, {
        type: 'warning',
        buttons: ['Stop the server and quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Stop DinePOS Server?',
        message: 'Stop the DinePOS server?',
        detail: 'Billing terminals, captain phones and kitchen screens stop working until it starts again. Bills already saved are safe.',
      });
      if (r.response !== 0) return;
    }
    quitting = true;
    await supervisor.stop();
    tray?.destroy();
    app.quit();
  };

  // the window's buttons; only that window may ask
  const own = (e: IpcMainInvokeEvent) => {
    if (!win || e.sender !== win.webContents) throw new Error('not the DinePOS Server window');
  };
  ipcMain.handle('server:snapshot', (e) => {
    own(e);
    return { ...supervisor.snapshot(), log: supervisor.log(), version: app.getVersion() };
  });
  ipcMain.handle('server:start', (e) => (own(e), supervisor.start()));
  ipcMain.handle('server:stop', (e) => (own(e), supervisor.stop()));
  ipcMain.handle('server:restart', (e) => (own(e), supervisor.restart()));
  ipcMain.handle('server:open-data', (e) => (own(e), shell.openPath(command.dataDir)));
  ipcMain.handle('server:open-logs', (e) => (own(e), shell.openPath(path.join(command.dataDir, 'logs'))));
  ipcMain.handle('server:open-terminal', (e) => {
    own(e);
    // the billing app itself, as its own process (a terminal on this PC)
    spawn(process.execPath, app.isPackaged ? [] : [app.getAppPath()], { detached: true, stdio: 'ignore', env: { ...process.env, DINEPOS_SERVER_URL: `http://127.0.0.1:${command.port}` } }).unref();
  });
  ipcMain.handle('server:quit', (e) => (own(e), quit()));

  app.on('second-instance', show);
  app.on('window-all-closed', () => undefined); // the server lives on in the tray
  app.on('before-quit', () => {
    quitting = true;
  });

  void (async () => {
    Menu.setApplicationMenu(null);
    tray = new Tray(icons.starting);
    tray.setToolTip('DinePOS Server');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open DinePOS Server', click: show },
        { label: 'Restart the server', click: () => void supervisor.restart() },
        { type: 'separator' },
        { label: 'Quit (stops the server)', click: () => void quit() },
      ]),
    );
    tray.on('click', show);
    // started minimised (Windows start-up): only the tray icon; otherwise the window
    if (!process.argv.includes('--minimized')) show();
    await supervisor.start();
    setInterval(() => void supervisor.poll(), 3000).unref();
    void supervisor.poll();
  })();
}
