// DinePOS Server window (`DinePOS.exe --server`, the "DinePOS Server" shortcut on the master PC): runs the outlet server
// under a ServerSupervisor and shows it: status, addresses and QR codes for phones and kitchen screens, devices,
// printers, backups, the cloud and the live log. It starts in the tray only (icon by the clock): a click on the icon,
// or opening the shortcut again, shows the window. Closing the window keeps the server running; Quit stops it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { ORIGIN } from './protocol.js';
import { opensWindowAtStart, serverCommand, ServerSupervisor } from './server-supervisor.js';

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
  // a Mac menu bar is 22 pt high: the 32 px dot is drawn at 2x (16 pt)
  return nativeImage.createFromBuffer(png, { scaleFactor: process.platform === 'darwin' ? 2 : 1 });
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
    if (process.platform === 'darwin') app.focus({ steal: true }); // no Dock icon: bring the window forward
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
    if (process.platform === 'darwin') {
      // a menu-bar item only (no Dock icon), like the tray icon on Windows; Edit keeps copy and paste working
      app.dock?.hide();
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else Menu.setApplicationMenu(null);
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
    // only the tray icon (after install, at Windows start, from the shortcut); --show opens the window too
    if (opensWindowAtStart()) show();
    else if (process.platform === 'win32') tray.displayBalloon({ title: 'DinePOS Server is running', content: 'It runs in the background. Click the DinePOS icon by the clock to open it.', noSound: true });
    await supervisor.start();
    setInterval(() => void supervisor.poll(), 3000).unref();
    void supervisor.poll();
  })();
}
