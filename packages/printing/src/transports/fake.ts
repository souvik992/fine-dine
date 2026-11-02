import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrintRequest, Transport } from './types.js';

/** Dev printer (docs/06): writes the text preview to `<dir>/<printerId>/<jobId>.txt`. */
export class FakeTransport implements Transport {
  readonly sent: PrintRequest[] = [];

  constructor(private readonly dir: string) {}

  async send(req: PrintRequest): Promise<void> {
    const folder = path.join(this.dir, safe(req.printer.id));
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${safe(req.jobId)}.txt`), req.preview ?? '(no preview)\n', 'utf8');
    this.sent.push(req);
  }
}

/** Ids are ULIDs; anything else is reduced to a safe file name. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
