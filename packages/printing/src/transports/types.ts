/** What a transport needs to know about a printer (a subset of the `printer` row). */
export interface PrinterTarget {
  id: string;
  name: string;
  /**
   * tcp: network / Wi-Fi (host:port) · usb: a Windows printer (driver installed; windowsName) · usbdirect: a USB
   * printer with no driver (device = vendor:product[:serial]) · serial: Bluetooth or COM port (device = COM5[:baud]) ·
   * fake: screen only (text files, no paper).
   */
  transport: 'tcp' | 'usb' | 'usbdirect' | 'serial' | 'fake';
  host?: string | null;
  port?: number | null;
  windowsName?: string | null;
  device?: string | null;
  /** 'slow_buffer' sends smaller pieces (cheap or Bluetooth printers that cut long tickets short). */
  profile?: string | null;
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
