// Runs a constant Windows PowerShell 5.1 script (ships with every Windows 10/11). Adapted from quickPOS printing.
// Safety rules for every caller: the script text is a constant; anything from the database or a person goes in an
// environment variable or on stdin, never on the command line. Output is capped; a timeout kills the process.
import { spawn } from 'node:child_process';
import { powershellPath } from './usb-windows.js';

export interface PsResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}
export interface PsRequest {
  script: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  maxOutput?: number;
}
export type PsRunner = (r: PsRequest) => Promise<PsResult>;

export const runPowerShell: PsRunner = (r) =>
  new Promise((resolve) => {
    const encoded = Buffer.from(r.script, 'utf16le').toString('base64');
    const max = r.maxOutput ?? 4096;
    const child = spawn(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, ...(r.env ?? {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (res: PsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr, timedOut: true });
    }, r.timeoutMs ?? 30_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      if (stdout.length < max) stdout += d;
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (stderr.length < 4096) stderr += d;
    });
    child.on('error', (e) => finish({ code: null, stdout, stderr: String(e.message) }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
    child.stdin.on('error', () => undefined); // reported through close
    child.stdin.end(r.stdin ?? '');
  });

/** How many bytes go to the printer at a time: `slow_buffer` for cheap or Bluetooth printers that drop long tickets. */
export const PROFILES = { generic: { chunk: 1024 }, slow_buffer: { chunk: 256 } } as const;
export type PrinterProfile = keyof typeof PROFILES;
export const chunkFor = (profile: string | null | undefined): number => (profile === 'slow_buffer' ? PROFILES.slow_buffer.chunk : PROFILES.generic.chunk);
