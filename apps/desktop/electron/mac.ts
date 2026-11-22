// The Mac app (no installer script there): the Mac's own menus, and "This Mac is the main computer", which on Windows is
// the installer's "Install as master" + "Start with Windows". When it is on, opening DinePOS also starts the DinePOS
// Server (its own process and tray icon, `--server`), and DinePOS opens when someone signs in to the Mac. The server
// process holds its own single-instance lock, so starting it again while it runs does nothing.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, type MenuItemConstructorOptions } from 'electron';

export const IS_MAC = process.platform === 'darwin';

/** A marker file in this terminal's profile: present = this Mac runs the outlet server. */
const flagFile = () => path.join(app.getPath('userData'), 'main-computer');

export function isMainComputer(): boolean {
  return IS_MAC && existsSync(flagFile());
}

/** Starts the DinePOS Server on this Mac (its tray icon; `show`: its window too). */
export function startServerHere(show: boolean): void {
  const args = app.isPackaged ? ['--server'] : [app.getAppPath(), '--server'];
  if (show) args.push('--show');
  spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
}

export function setMainComputer(on: boolean): void {
  if (on) writeFileSync(flagFile(), 'This Mac runs the DinePOS outlet server.\n');
  else rmSync(flagFile(), { force: true });
  // DinePOS opens at sign-in (and with it the server); the login item is only for the installed app
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
  if (on) startServerHere(true);
}

/** The Mac's app menu (About, Hide, Quit) and Edit menu: without it ⌘C / ⌘V / ⌘Q do not work in text boxes. */
export function macMenus(extra: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return [
    { role: 'appMenu' },
    ...extra,
    { role: 'editMenu' },
  ];
}

/** The terminal's "Server" menu on a Mac. */
export function macServerMenu(rebuild: () => void): MenuItemConstructorOptions {
  return {
    label: 'Server',
    submenu: [
      {
        label: 'This Mac is the main computer (runs the DinePOS server)',
        type: 'checkbox',
        checked: isMainComputer(),
        click: (item) => {
          setMainComputer(item.checked);
          rebuild();
        },
      },
      { label: 'Open DinePOS Server', enabled: isMainComputer(), click: () => startServerHere(true) },
    ],
  };
}
