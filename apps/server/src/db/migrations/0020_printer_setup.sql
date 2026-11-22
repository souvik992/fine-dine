-- dinepos: foreign-keys-off
-- Settings › Printers (quickPOS printer setup): more ways to connect a printer, and printer options.
--   transport  + usbdirect (a USB printer with no Windows driver; device = vendor:product[:serial])
--              + serial    (a Bluetooth or COM port printer; device = COM5[:baud])
--   device     the USB id or COM port of a usbdirect / serial printer
--   profile    'slow_buffer' sends smaller pieces (cheap or Bluetooth printers that cut long tickets short)
--   active     0: turned off (nothing new is sent to it; kept for its print history)
--   drawer     1: open the cash drawer plugged into it when a bill is settled with cash
-- SQLite cannot change a CHECK in place, so the table is rebuilt (SQLite's 12-step ALTER) with foreign keys off;
-- the migration runner checks every reference before this commits. Every printer is kept as it was; existing
-- printers do not open a drawer on cash bills until that is ticked.
CREATE TABLE printer_v2 (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('tcp','usb','usbdirect','serial','fake')),
  host TEXT, port INTEGER DEFAULT 9100, windows_name TEXT, device TEXT,
  width_mm INTEGER NOT NULL DEFAULT 80, bitmap_text INTEGER NOT NULL DEFAULT 0,
  copies INTEGER NOT NULL DEFAULT 1, cutter INTEGER NOT NULL DEFAULT 1,
  backup_printer_id TEXT REFERENCES printer(id), role TEXT NOT NULL DEFAULT 'kot' CHECK (role IN ('kot','bill','both')),
  profile TEXT NOT NULL DEFAULT 'generic' CHECK (profile IN ('generic','slow_buffer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  drawer INTEGER NOT NULL DEFAULT 0 CHECK (drawer IN (0,1))
);
INSERT INTO printer_v2 (id, name, transport, host, port, windows_name, width_mm, bitmap_text, copies, cutter, backup_printer_id, role)
  SELECT id, name, transport, host, port, windows_name, width_mm, bitmap_text, copies, cutter, backup_printer_id, role FROM printer;
DROP TABLE printer;
ALTER TABLE printer_v2 RENAME TO printer;
