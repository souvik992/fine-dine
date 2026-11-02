// Windows spooler transport for USB / driver-installed printers. Adapted from Tiffin POS printing/spooler.
//
// Sends ESC/POS bytes as a RAW job through winspool.drv (OpenPrinter, StartDocPrinter "RAW", WritePrinter) from a
// short-lived Windows PowerShell 5.1 process (ships with every Windows 10/11), so no native module is needed.
// Safety: the script is a constant. The printer name goes in an environment variable and the bytes on stdin
// (base64); nothing from the database ever reaches a command line. A failed write aborts the job so a retry
// never prints after half a ticket. "Success" means the spooler accepted every byte, not that paper came out.
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { PrintRequest, Transport } from './types.js';

export interface SpoolRequest {
  printerName: string;
  docName: string;
  bytes: Uint8Array;
}
export interface SpoolResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}
export type SpoolRunner = (r: SpoolRequest) => Promise<SpoolResult>;

export const SPOOLER_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DinePosRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool AbortPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, IntPtr buf, int count, out int written);

  public static string Send(string printer, byte[] data, string docName) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "ERR open " + Marshal.GetLastWin32Error();
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = docName;
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "ERR startdoc " + Marshal.GetLastWin32Error();
      if (!StartPagePrinter(h)) { int e0 = Marshal.GetLastWin32Error(); AbortPrinter(h); return "ERR startpage " + e0; }
      IntPtr p = Marshal.AllocCoTaskMem(Math.Max(1, data.Length));
      int off = 0;
      try {
        Marshal.Copy(data, 0, p, data.Length);
        while (off < data.Length) {
          int w;
          if (!WritePrinter(h, IntPtr.Add(p, off), data.Length - off, out w)) { int e1 = Marshal.GetLastWin32Error(); AbortPrinter(h); return "ERR write " + e1; }
          if (w <= 0) { AbortPrinter(h); return "ERR write 0"; }
          off += w;
        }
      } finally { Marshal.FreeCoTaskMem(p); }
      if (!EndPagePrinter(h)) { int e2 = Marshal.GetLastWin32Error(); AbortPrinter(h); return "ERR endpage " + e2; }
      if (!EndDocPrinter(h)) return "ERR enddoc " + Marshal.GetLastWin32Error();
      return "OK " + off;
    } finally { ClosePrinter(h); }
  }
}
'@
$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
[Console]::Out.Write([DinePosRawPrint]::Send($env:DINEPOS_SPOOL_PRINTER, $data, $env:DINEPOS_SPOOL_DOC))
`;

/** Full path, so a powershell.exe planted in the working directory or on PATH is never used. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function powershellRunner(timeoutMs = 30_000): SpoolRunner {
  const encoded = Buffer.from(SPOOLER_SCRIPT, 'utf16le').toString('base64');
  return (r) =>
    new Promise((resolve) => {
      const child = spawn(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        env: { ...process.env, DINEPOS_SPOOL_PRINTER: r.printerName, DINEPOS_SPOOL_DOC: r.docName },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (res: SpoolResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ code: null, stdout, stderr, timedOut: true });
      }, timeoutMs);
      child.stdout.setEncoding('utf8').on('data', (d: string) => {
        if (stdout.length < 4096) stdout += d;
      });
      child.stderr.setEncoding('utf8').on('data', (d: string) => {
        if (stderr.length < 4096) stderr += d;
      });
      child.on('error', (e) => finish({ code: null, stdout, stderr: e.message }));
      child.on('close', (code) => finish({ code, stdout, stderr }));
      child.stdin.on('error', () => undefined); // reported through close
      child.stdin.end(Buffer.from(r.bytes).toString('base64'));
    });
}

const WIN32_HINTS: Record<number, string> = {
  5: 'cannot be used: Windows denied permission',
  1801: 'was not found in Windows. Check the printer name in Settings, Printers',
  1804: 'does not accept RAW data. Use a "Generic / Text Only" or ESC/POS driver for it',
  1722: 'is unavailable because the Windows print spooler is not running',
  1726: 'is unavailable because the Windows print spooler is not running',
};

export class WindowsSpoolerTransport implements Transport {
  private readonly platform: NodeJS.Platform;
  private run: SpoolRunner | null;
  private readonly timeoutMs: number;

  constructor(opts: { platform?: NodeJS.Platform; run?: SpoolRunner; timeoutMs?: number } = {}) {
    this.platform = opts.platform ?? process.platform;
    this.run = opts.run ?? null;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async send({ printer, bytes }: PrintRequest): Promise<void> {
    if (this.platform !== 'win32') throw new Error('USB printers are only supported on Windows.');
    const name = printer.windowsName?.trim();
    if (!name) throw new Error(`Printer "${printer.name}" needs its Windows printer name. Set it in Settings, Printers.`);
    this.run ??= powershellRunner(this.timeoutMs);
    const res = await this.run({ printerName: name, docName: `DinePOS ${printer.name}`.slice(0, 60), bytes });
    if (res.timedOut) throw new Error(`Printer "${name}" timed out. Check that it is on and its Windows queue is not paused.`);

    const out = res.stdout.trim();
    const ok = /^OK (\d+)$/.exec(out);
    if (ok && res.code === 0) {
      if (Number(ok[1]) !== bytes.length) throw new Error(`Printer "${name}" accepted only part of the ticket. It will be sent again.`);
      return;
    }
    const err = /^ERR (\w+) (\d+)$/.exec(out);
    if (err) {
      const stage = err[1]!;
      const code = Number(err[2]);
      const hint = WIN32_HINTS[code];
      if (hint) throw new Error(`Printer "${name}" ${hint}.`);
      if (stage === 'write') throw new Error(`Printer "${name}" stopped while printing (Windows error ${code}). Check the cable and power.`);
      throw new Error(`Printer "${name}" could not start a print job (Windows error ${code} at ${stage}).`);
    }
    // PowerShell itself failed (blocked by policy or antivirus). Never show its raw output.
    throw new Error('DinePOS could not start the Windows print helper. Check that antivirus is not blocking PowerShell.');
  }
}
