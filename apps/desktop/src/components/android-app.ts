// DinePOS for Android (apps/android): the screens run inside the app's window, which adds window.DinePosAndroid
// (MainActivity.Bridge) and tells them about USB printers plugged into the device (UsbPrinters.java).

interface DinePosAndroidBridge {
  /** Asks Android again to let DinePOS use the USB printer "vid:pid". */
  allowUsbPrinter?: (device: string) => void;
}

/** The Android app's bridge, or null on a PC (Windows, Mac) or in a browser. */
export function androidApp(): DinePosAndroidBridge | null {
  return typeof window === 'undefined' ? null : ((window as { DinePosAndroid?: DinePosAndroidBridge }).DinePosAndroid ?? null);
}

/** Where the printers are plugged in, in words: this device (Android) or the main PC. */
export const printerHost = (): string => (androidApp() ? 'this device' : 'the main PC');

/** The page event the Android app sends when a USB printer is plugged in, allowed or unplugged. */
export const USB_PRINTER_EVENT = 'dinepos-usb-printer';
export interface UsbPrinterEvent {
  event: 'connected' | 'needs-allow' | 'not-allowed' | 'unplugged';
  /** DinePOS device "vid:pid" (lower case), as in GET /v1/printers/usb-devices. */
  device: string;
  name: string;
}
