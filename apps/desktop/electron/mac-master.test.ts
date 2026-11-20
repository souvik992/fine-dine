import { describe, expect, it } from 'vitest';
import { launchAgentPath, launchAgentPlist, parseMacRole } from './mac-master.js';
import { serverCommand } from './server-supervisor.js';

describe('Mac master (the .dmg has no installer page)', () => {
  it('starts the DinePOS Server at login with a LaunchAgent in the user’s Library', () => {
    expect(launchAgentPath('/Users/anna')).toBe('/Users/anna/Library/LaunchAgents/com.dinepos.server.plist');
    const plist = launchAgentPlist('/Applications/DinePOS.app/Contents/MacOS/DinePOS');
    expect(plist).toContain('<string>/Applications/DinePOS.app/Contents/MacOS/DinePOS</string>\n    <string>--server</string>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(launchAgentPlist('/Apps/A&B.app/x')).toContain('/Apps/A&amp;B.app/x');
  });

  it('remembers the answer; anything else asks again', () => {
    expect(parseMacRole('{"role":"master"}')).toBe('master');
    expect(parseMacRole('{"role":"terminal"}')).toBe('terminal');
    expect(parseMacRole('{"role":"x"}')).toBeNull();
    expect(parseMacRole('nope')).toBeNull();
    expect(parseMacRole(null)).toBeNull();
  });

  it('runs the bundled `node` (not node.exe) with data in /Users/Shared/DinePOS', () => {
    const c = serverCommand({}, '/Applications/DinePOS.app/Contents/Resources', 'darwin');
    expect(c.node).toBe('/Applications/DinePOS.app/Contents/Resources/server/node');
    expect(c.args).toEqual(['/Applications/DinePOS.app/Contents/Resources/server/server.mjs']);
    expect(c.dataDir).toBe('/Users/Shared/DinePOS');
    const w = serverCommand({ ProgramData: 'C:\\ProgramData' }, 'C:\\Program Files\\DinePOS\\resources', 'win32');
    expect(w.node).toBe('C:\\Program Files\\DinePOS\\resources\\server\\node.exe');
    expect(w.dataDir).toBe('C:\\ProgramData\\DinePOS');
  });
});
