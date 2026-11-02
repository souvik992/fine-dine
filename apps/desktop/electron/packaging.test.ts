// Static checks on the installer inputs (P1-11). They run in CI without building or installing anything.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const xml = read('../build/service/DinePOS-Server.xml');
const nsh = read('../build/installer.nsh');
const config = createRequire(import.meta.url)('../electron-builder.config.cjs') as {
  nsis: Record<string, unknown>;
  extraResources: Array<{ from: string; to: string }>;
  files: string[];
};

const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

describe('Windows service definition (WinSW)', () => {
  it('runs the bundled server with the bundled Node runtime', () => {
    expect(tag('id')).toBe('DinePOSServer');
    expect(tag('executable')).toBe('%BASE%\\node.exe');
    expect(tag('arguments')).toBe('"%BASE%\\server.mjs"');
  });

  it('starts at boot and restarts after a crash', () => {
    expect(tag('startmode')).toBe('Automatic');
    expect(xml.match(/<onfailure action="restart"/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('runs in production with data and logs in %ProgramData%\\DinePOS, listening on the LAN at 7420', () => {
    expect(xml).toContain('<env name="NODE_ENV" value="production"/>');
    expect(xml).toContain('<env name="DATA_DIR" value="%ProgramData%\\DinePOS"/>');
    expect(xml).toContain('<env name="DINEPOS_HOST" value="0.0.0.0"/>');
    expect(xml).toContain('<env name="DINEPOS_PORT" value="7420"/>');
    expect(tag('logpath')).toBe('%ProgramData%\\DinePOS\\logs');
  });

  it('gives the server time to stop cleanly', () => {
    expect(tag('stoptimeout')).toBe('15 sec');
  });
});

describe('installer script (NSIS)', () => {
  it('offers "Install as master" and accepts /MASTER= for unattended installs', () => {
    expect(nsh).toContain('Install as master');
    expect(nsh).toContain('"/MASTER="');
    expect(nsh).toMatch(/ReadRegStr \$0 HKLM "\$\{DINEPOS_REG_KEY\}" "Master"/); // upgrades keep the choice
  });

  it('installs and starts the service and opens 7420 on private networks only', () => {
    expect(nsh).toContain('"${DINEPOS_SERVICE_EXE}" install');
    expect(nsh).toContain('"${DINEPOS_SERVICE_EXE}" start');
    expect(nsh).toContain('localport=7420 profile=private,domain');
    expect(nsh).not.toMatch(/profile=[^\s']*public/);
  });

  it('removes the service on uninstall but never deletes %ProgramData%\\DinePOS', () => {
    const uninstall = nsh.slice(nsh.indexOf('!macro customUnInstall'));
    expect(uninstall).toContain('"${DINEPOS_SERVICE_EXE}" uninstall');
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

describe('electron-builder config', () => {
  it('is a per-machine assisted installer that keeps user data', () => {
    expect(config.nsis).toMatchObject({ oneClick: false, perMachine: true, deleteAppDataOnUninstall: false, include: 'build/installer.nsh' });
  });

  it('ships the server, its node_modules, node.exe and the service wrapper', () => {
    const to = config.extraResources.map((r) => r.to);
    expect(to).toEqual(expect.arrayContaining(['server', 'server/node_modules', 'server/node.exe', 'server/DinePOS-Server.exe', 'server/DinePOS-Server.xml']));
  });

  it('keeps node_modules out of the app archive (everything is bundled)', () => {
    expect(config.files).toContain('!node_modules{,/**/*}');
  });
});
