// The Mac's answer to the Windows installer's "Install as master" page (build/installer.nsh). A .dmg has no install
// steps, so the app asks once, at first start, whether this Mac is the master. On the master it starts the DinePOS
// Server (DinePOS --server: a menu-bar item) and, for "start at login", writes a LaunchAgent that runs it when someone
// signs in. Pure helpers here (tested); mac-setup.ts does it with Electron.
import path from 'node:path';

/** Same as the server's default data folder on a Mac (apps/server/src/config.ts). */
export const MAC_DATA_DIR = '/Users/Shared/DinePOS';
export const LAUNCH_AGENT_LABEL = 'com.dinepos.server';

export type MacRole = 'master' | 'terminal';

/** ~/Library/LaunchAgents/com.dinepos.server.plist */
export function launchAgentPath(home: string): string {
  return path.posix.join(home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Runs `<exe> --server` (the menu-bar DinePOS Server) at login; not kept alive by launchd (the app restarts the server itself). */
export function launchAgentPlist(exe: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(exe)}</string>
    <string>--server</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
}

/** The saved answer (userData/mac-role.json), or null when the question was never answered. */
export function parseMacRole(text: string | null): MacRole | null {
  if (!text) return null;
  try {
    const role = (JSON.parse(text) as { role?: unknown }).role;
    return role === 'master' || role === 'terminal' ? role : null;
  } catch {
    return null;
  }
}
