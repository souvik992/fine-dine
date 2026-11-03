// This PC's hardware id for licensing (docs/07): a hash of stable machine identifiers — Windows MachineGuid and the
// system disk's volume serial — so reinstalling on the same PC keeps the same id (and the same key keeps working).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';

const run = (file: string, args: string[]): string => {
  try {
    return execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

/** The raw identifiers (exported for tests of the formatting only). */
export function machineIdentifiers(): string[] {
  if (platform() === 'win32') {
    const guid = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']))?.[1] ?? '';
    const drive = process.env.SystemDrive ?? 'C:';
    const serial = /([0-9A-F]{4}-[0-9A-F]{4})/i.exec(run('cmd', ['/c', 'vol', drive]))?.[1] ?? '';
    return [guid, serial];
  }
  let machineId = '';
  try {
    machineId = readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {
    // not Linux
  }
  return [machineId || hostname()];
}

/** "AB12-CD34-EF56-7890-1A2B": 20 hex digits of SHA-256, easy to read out over the phone. */
export function formatHardwareId(identifiers: readonly string[]): string {
  const hex = createHash('sha256').update(`dinepos-hw:${identifiers.join('|')}`).digest('hex').slice(0, 20).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}

let cached: string | null = null;
export function hardwareId(): string {
  cached ??= formatHardwareId(machineIdentifiers());
  return cached;
}
