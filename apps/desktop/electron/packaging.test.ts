// Static checks on the installer inputs (P1-11). They run in CI without building or installing anything.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const nsh = read('../build/installer.nsh');
const stopScript = read('../build/server/stop-server.ps1');
const config = createRequire(import.meta.url)('../electron-builder.config.cjs') as {
  nsis: Record<string, unknown>;
  extraResources: Array<{ from: string; to: string }>;
  files: string[];
};

describe('installer script (NSIS): standalone server like the order hub', () => {
  it('offers "Install as master" and "Start with Windows", with /MASTER= and /AUTOSTART= for unattended installs', () => {
    expect(nsh).toContain('Install as master');
    expect(nsh).toContain('Start the DinePOS Server when Windows starts');
    expect(nsh).toContain('"/MASTER="');
    expect(nsh).toContain('"/AUTOSTART="');
    expect(nsh).toMatch(/ReadRegStr \$0 HKLM "\$\{DINEPOS_REG_KEY\}" "Master"/); // upgrades keep the choice
  });

  it('starts the bundled server through a "DinePOS Server" shortcut: the DinePOS Server window (no Windows service)', () => {
    expect(nsh).toContain('CreateShortCut "$SMPROGRAMS\\${DINEPOS_SERVER_LNK}" "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "--server"');
    // at Windows start: in the tray
    expect(nsh).toContain('CreateShortCut "$SMSTARTUP\\${DINEPOS_SERVER_LNK}" "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "--server --minimized"');
    expect(nsh).not.toMatch(/WinSW|sc\.exe|New-Service/i);
  });

  it('lets every local user write the data folder and starts the server as the signed-in user', () => {
    expect(nsh).toContain('icacls "$APPDATA\\DinePOS" /grant *S-1-5-32-545:(OI)(CI)M');
    expect(nsh).toContain('${StdUtils.ExecShellAsUser}');
  });

  it('opens 7420 on private networks only', () => {
    expect(nsh).toContain('localport=7420 profile=private,domain');
    expect(nsh).not.toMatch(/profile=[^\s']*public/);
  });

  it('stops the running server before uninstall/upgrade and never deletes %ProgramData%\\DinePOS', () => {
    const uninstall = nsh.slice(nsh.indexOf('!macro customUnInstall'));
    expect(uninstall).toContain('nsExec::ExecToLog ${DINEPOS_STOP_SERVER}');
    expect(nsh).toContain('-File "${DINEPOS_SERVER_DIR}\\stop-server.ps1"');
    expect(nsh).not.toMatch(/RMDir[^\n]*DinePOS/i);
    expect(nsh).not.toMatch(/Delete[^\n]*\$APPDATA\\DinePOS/i);
  });

  it('pops every nsExec result (keeps the NSIS stack balanced)', () => {
    const execs = nsh.match(/nsExec::ExecToLog/g)?.length ?? 0;
    const pops = nsh.match(/nsExec::ExecToLog[^\n]*\n\s*Pop \$0/g)?.length ?? 0;
    expect(execs).toBeGreaterThan(0);
    expect(pops).toBe(execs);
  });
});

describe('stop-server.ps1', () => {
  it('stops only the node.exe in its own folder', () => {
    expect(stopScript).toContain("Join-Path $PSScriptRoot 'node.exe'");
    expect(stopScript).toContain('$_.ExecutablePath -eq $node');
    expect(stopScript).not.toMatch(/taskkill|Stop-Process -Name/i);
  });
});

describe('electron-builder config', () => {
  it('is a per-machine assisted installer that keeps user data', () => {
    expect(config.nsis).toMatchObject({ oneClick: false, perMachine: true, deleteAppDataOnUninstall: false, include: 'build/installer.nsh' });
  });

  it('ships the server, its node_modules, node.exe and the stop script', () => {
    const to = config.extraResources.map((r) => r.to);
    expect(to).toEqual(expect.arrayContaining(['server', 'server/node_modules', 'server/node.exe', 'server/stop-server.ps1']));
  });

  it('keeps node_modules out of the app archive (everything is bundled)', () => {
    expect(config.files).toContain('!node_modules{,/**/*}');
  });
});
