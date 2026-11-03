// A plain phone-sized browser window for end-to-end tests of the web apps (captain, KDS): Electron with no app code,
// default security (sandbox, context isolation), loading OPEN_URL. Used by captain.e2e.test.ts and kds.e2e.test.ts.
const { app, BrowserWindow } = require('electron');

if (process.env.DINEPOS_USER_DATA_DIR) app.setPath('userData', process.env.DINEPOS_USER_DATA_DIR);
app.whenReady().then(() => {
  // A phone by default; WINDOW_SIZE="1280x800" for a kitchen screen.
  const [width, height] = (process.env.WINDOW_SIZE || '412x860').split('x').map(Number);
  const win = new BrowserWindow({ width, height, webPreferences: { sandbox: true, contextIsolation: true } });
  void win.loadURL(process.env.OPEN_URL);
});
app.on('window-all-closed', () => app.quit());
