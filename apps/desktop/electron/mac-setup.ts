// macOS only: what the Windows installer does on its "Install as master" page (build/installer.nsh), done by the app,
// because a .dmg has no install steps. See mac-master.ts. Also the Mac menu bar (DinePOS / Edit / View / Window): without
// an Edit menu, Cmd+C / Cmd+V do nothing in a Mac app's text fields.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { launchAgentPath, launchAgentPlist, MAC_DATA_DIR, parseMacRole, type MacRole } from './mac-master.js';

const roleFile = () => path.join(app.getPath('userData'), 'mac-role.json');

function readRole(): MacRole | null {
  try {
    return parseMacRole(readFileSync(roleFile(), 'utf8'));
  } catch {
    return null;
  }
}

function saveRole(role: MacRole): void {
  writeFileSync(roleFile(), JSON.stringify({ role }, null, 2));
}

export function startsAtLogin(): boolean {
  return existsSync(launchAgentPath(homedir()));
}

function setStartAtLogin(on: boolean): void {
  const file = launchAgentPath(homedir());
  if (on) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, launchAgentPlist(process.execPath));
  } else rmSync(file, { force: true });
}

/** The data folder, writable by every user of this Mac (the server runs as whoever is signed in), like ProgramData. */
function prepareDataDir(): void {
  try {
    mkdirSync(MAC_DATA_DIR, { recursive: true });
    chmodSync(MAC_DATA_DIR, 0o777);
  } catch {
    // made by another user already: the server says so if it cannot write there
  }
}

async function serverAnswers(): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:7420/v1/health', { signal: AbortSignal.timeout(1500) });
    return r.status > 0;
  } catch {
    return false;
  }
}

/** Opens the DinePOS Server (menu-bar item). A running one shows its window (single instance: second-instance). */
export function openServer(): void {
  spawn(process.execPath, app.isPackaged ? ['--server', '--show'] : [app.getAppPath(), '--server', '--show'], { detached: true, stdio: 'ignore' }).unref();
}

/** Starts the server in the menu bar only when none answers (e.g. the LaunchAgent already started it). */
async function ensureServer(): Promise<void> {
  if (await serverAnswers()) return;
  spawn(process.execPath, app.isPackaged ? ['--server'] : [app.getAppPath(), '--server'], { detached: true, stdio: 'ignore' }).unref();
}

async function becomeMaster(): Promise<void> {
  saveRole('master');
  prepareDataDir();
  setStartAtLogin(true);
  await ensureServer();
}

/**
 * First start on this Mac: master or billing terminal (the Windows installer's page). Later starts: the master starts
 * its server if it is not running. Only in the installed app (development runs the server with npm run dev:server).
 */
export async function macFirstRun(win: BrowserWindow | undefined, onAnswered: () => void): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged) return;
  const role = readRole();
  if (role === 'master') return ensureServer();
  if (role === 'terminal') return;
  const r = await dialog.showMessageBox(win ?? undefined!, {
    type: 'question',
    buttons: ['This Mac is the master', 'This Mac is a billing terminal'],
    defaultId: 0,
    cancelId: 1,
    title: 'Set up DinePOS',
    message: 'Is this Mac the master?',
    detail:
      'One computer in the restaurant is the master. It keeps the bills database, and every billing terminal, captain phone and kitchen screen connects to it.\n\n' +
      `The master runs the DinePOS Server in the menu bar (it starts when you sign in) and keeps its data in ${MAC_DATA_DIR}. ` +
      'If macOS asks whether "node" may accept incoming connections, choose Allow, so phones and other terminals can reach it.\n\n' +
      'On a billing terminal, enter the master’s address in DinePOS Settings. You can change this later in the DinePOS menu.',
  });
  if (r.response === 0) await becomeMaster();
  else saveRole('terminal');
  onAnswered(); // the menu shows the answer
}

/** The Mac menu bar for the billing app. */
export function buildMacMenu(newWindow: () => unknown, extraView: MenuItemConstructorOptions[] = []): void {
  const master = readRole() === 'master';
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Open DinePOS Server', enabled: master || startsAtLogin(), click: openServer },
        {
          label: 'This Mac is the master (runs the DinePOS Server)',
          type: 'checkbox',
          checked: master,
          click: (item) => {
            void (async () => {
              if (item.checked) await becomeMaster();
              else {
                saveRole('terminal');
                setStartAtLogin(false);
                void dialog.showMessageBox({ type: 'info', message: 'This Mac is now a billing terminal.', detail: `The DinePOS Server no longer starts when you sign in. If it is running, quit it from its menu-bar icon. Your data stays in ${MAC_DATA_DIR}.` });
              }
              buildMacMenu(newWindow, extraView);
            })();
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'File', submenu: [{ label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => newWindow() }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, ...extraView] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
