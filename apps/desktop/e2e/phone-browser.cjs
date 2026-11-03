// A plain phone-sized browser window for end-to-end tests of the web apps (captain, KDS): Electron with no app code,
// default security (sandbox, context isolation), loading OPEN_URL. Used by captain.e2e.test.ts.
const { app, BrowserWindow } = require('electron');

if (process.env.DINEPOS_USER_DATA_DIR) app.setPath('userData', process.env.DINEPOS_USER_DATA_DIR);
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 412, height: 860, webPreferences: { sandbox: true, contextIsolation: true } });
  void win.loadURL(process.env.OPEN_URL);
});
app.on('window-all-closed', () => app.quit());
