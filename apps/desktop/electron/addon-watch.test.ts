import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addonsDirOf, addonsFingerprint, AddonWatcher } from './addon-watch.js';

// The DinePOS Server tray offers a restart when an add-on is installed, updated or removed while the server runs
// (the server reads add-ons only when it starts).
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'addons-'));
  dirs.push(d);
  return d;
};
const install = (dir: string, id: string, version: string) => {
  mkdirSync(path.join(dir, id), { recursive: true });
  writeFileSync(path.join(dir, id, 'manifest.json'), JSON.stringify({ id, version }));
};

describe('add-on watch', () => {
  it('finds the add-ons folder as the server does', () => {
    expect(addonsDirOf({ env: {}, dataDir: 'C:\\ProgramData\\DinePOS' })).toBe(path.join('C:\\ProgramData\\DinePOS', 'addons'));
    expect(addonsDirOf({ env: { DINEPOS_ADDONS_DIR: 'D:\\addons' }, dataDir: 'C:\\ProgramData\\DinePOS' })).toBe('D:\\addons');
  });

  it('a folder fingerprint changes on install, update and removal, not on other files', () => {
    const dir = tmp();
    const none = addonsFingerprint(dir);
    install(dir, 'tableqr', '1.1.0');
    const v110 = addonsFingerprint(dir);
    expect(v110).not.toBe(none);
    writeFileSync(path.join(dir, 'tableqr', 'backend.cjs'), 'x');
    expect(addonsFingerprint(dir)).toBe(v110);
    install(dir, 'tableqr', '1.1.1');
    expect(addonsFingerprint(dir)).not.toBe(v110);
    rmSync(path.join(dir, 'tableqr', 'manifest.json')); // an uninstall removes the signature first
    expect(addonsFingerprint(dir)).toMatch(/^tableqr:-$/);
    expect(addonsFingerprint(path.join(dir, 'missing'))).toBe('');
  });

  it('says so once when the folder stays different from what the running server loaded', () => {
    const dir = tmp();
    let told = 0;
    const w = new AddonWatcher({ dir, onChanged: () => told++ });
    w.check();
    expect(told).toBe(0); // the server has not started: nothing to compare with
    w.serverStarted();
    w.check();
    install(dir, 'tableqr', '1.1.0');
    w.check();
    expect(told).toBe(0); // one look: maybe still copying, or an installer about to restart the server
    w.check();
    expect(told).toBe(1);
    w.check();
    w.check();
    expect(told).toBe(1); // "Later" is not asked again for the same change
    install(dir, 'tableqr', '1.1.1');
    w.check();
    w.check();
    expect(told).toBe(2); // a newer change is
  });

  it('an installer that restarts the server itself is not asked about; a removal is', () => {
    const dir = tmp();
    let told = 0;
    const w = new AddonWatcher({ dir, onChanged: () => told++ });
    w.serverStarted();
    install(dir, 'tableqr', '1.1.0');
    w.check();
    w.serverStarted(); // the installer restarted the server: it loaded the new package
    w.check();
    w.check();
    expect(told).toBe(0);
    rmSync(path.join(dir, 'tableqr'), { recursive: true });
    w.check();
    w.check();
    expect(told).toBe(1);
  });
});
