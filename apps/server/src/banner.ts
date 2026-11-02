// The start-up message shown in the server window (like the order hub prints its links on start).
import { networkInterfaces } from 'node:os';

/** IPv4 addresses other devices on the LAN can use to reach this PC (no loopback, no link-local). */
export function lanAddresses(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

export interface BannerInfo {
  version: string;
  host: string;
  port: number;
  dataDir: string;
  businessDate: string;
  logFile: string | null;
  lan: string[];
}

export function formatBanner(i: BannerInfo): string {
  const listensOnLan = i.host === '0.0.0.0' || i.host === '::';
  const lines = [
    '',
    `  DinePOS outlet server ${i.version} is running.`,
    '',
    `  On this PC:       http://127.0.0.1:${i.port}`,
  ];
  if (listensOnLan) {
    if (i.lan.length) {
      i.lan.forEach((ip, n) => lines.push(`  ${n === 0 ? 'Other devices:    ' : '                  '}http://${ip}:${i.port}`));
      lines.push('                    (enter this address in DinePOS Settings on billing terminals)');
    } else {
      lines.push('  Other devices:    no network connection found; only this PC can connect.');
    }
  } else {
    lines.push(`  Other devices:    off (listening on ${i.host} only)`);
  }
  lines.push(`  Data folder:      ${i.dataDir}`, `  Business date:    ${i.businessDate}`);
  if (i.logFile) lines.push(`  Log file:         ${i.logFile}`);
  lines.push('', '  Keep this window open while the restaurant is working.', '  Close it (or press Ctrl+C) to stop the server safely.', '');
  return lines.join('\n');
}
