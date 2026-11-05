/** What a transport needs to know about a printer (a subset of the `printer` row). */
export interface PrinterTarget {
  id: string;
  name: string;
  transport: 'tcp' | 'usb' | 'fake';
  host?: string | null;
  port?: number | null;
  windowsName?: string | null;
}

export interface PrintRequest {
  printer: PrinterTarget;
  jobId: string;
  bytes: Uint8Array;
  /** Plain-text preview; the fake printer writes this instead of bytes. */
  preview?: string | null;
}

/**
 * Sends one job. Resolves only when the device (or spooler) accepted every byte; rejects with a plain-language
 * message otherwise. Transports never retry: the print worker owns retries and backoff.
 */
export interface Transport {
  send(req: PrintRequest): Promise<void>;
  /**
   * Checks the printer is there without printing anything (the status light between jobs). Resolves when it
   * answers; rejects with a plain-language message otherwise. Transports without a way to check leave it out.
   */
  probe?(printer: PrinterTarget): Promise<void>;
}
