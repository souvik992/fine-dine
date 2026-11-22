import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, denyAll, useHarness } from '../testing/command-harness.js';

describe('UpsertPrinter', () => {
  const h = useHarness();
  const printer = { id: newId(), name: 'Kitchen', transport: 'tcp', host: '192.168.1.50' };
  adminBasics(h, 'UpsertPrinter', 'printer', () => ({ ...printer }));

  it('stores defaults and clears fields that do not apply to the transport', () => {
    h.run('UpsertPrinter', { ...printer, windowsName: 'ignored' });
    expect(h.db.prepare('SELECT port, width_mm, windows_name, cutter FROM printer WHERE id = ?').get(printer.id)).toEqual({
      port: 9100,
      width_mm: 80,
      windows_name: null,
      cutter: 1,
    });
  });

  it('VALIDATION when a TCP printer has no host or a USB printer no Windows name', () => {
    h.fail('UpsertPrinter', { id: newId(), name: 'x', transport: 'tcp' }, 'VALIDATION');
    h.fail('UpsertPrinter', { id: newId(), name: 'x', transport: 'usb' }, 'VALIDATION');
    h.fail('UpsertPrinter', { ...printer, widthMm: 72 }, 'VALIDATION');
  });

  it('NOT_FOUND for an unknown backup and INVALID_STATE for mutual backups', () => {
    h.fail('UpsertPrinter', { ...printer, backupPrinterId: newId() }, 'NOT_FOUND');
    const b = newId();
    h.run('UpsertPrinter', printer);
    h.run('UpsertPrinter', { id: b, name: 'Backup', transport: 'fake', backupPrinterId: printer.id });
    h.fail('UpsertPrinter', { ...printer, backupPrinterId: b }, 'INVALID_STATE');
  });
});

// Settings › Printers (quickPOS printer setup): more connections, printer options, stations set from the printer.
describe('UpsertPrinter: printer setup', () => {
  const h = useHarness();
  const station = (name: string) => {
    const id = newId();
    h.run('UpsertStation', { id, name, printerIds: [] });
    return id;
  };
  const job = (printerId: string, state: string) =>
    h.db.prepare("INSERT INTO print_job (id, printer_id, doc_kind, bytes, state, created_at) VALUES (?, ?, 'test', x'00', ?, '2026-11-02T08:00:00Z')").run(newId(), printerId, state);

  it('a USB printer with no driver keeps its USB id; a Bluetooth printer its COM port; each refused without one', () => {
    const usb = newId();
    const bt = newId();
    h.run('UpsertPrinter', { id: usb, name: 'Counter', transport: 'usbdirect', device: '0416:5011', role: 'bill', drawer: true });
    h.run('UpsertPrinter', { id: bt, name: 'Bar', transport: 'serial', device: 'COM5:115200', profile: 'slow_buffer', host: 'ignored' });
    expect(h.db.prepare('SELECT transport, device, host, drawer, profile, active FROM printer WHERE id IN (?, ?) ORDER BY name').all(bt, usb)).toEqual([
      { transport: 'serial', device: 'COM5:115200', host: null, drawer: 0, profile: 'slow_buffer', active: 1 },
      { transport: 'usbdirect', device: '0416:5011', host: null, drawer: 1, profile: 'generic', active: 1 },
    ]);
    h.fail('UpsertPrinter', { id: newId(), name: 'x', transport: 'usbdirect' }, 'VALIDATION');
    h.fail('UpsertPrinter', { id: newId(), name: 'x', transport: 'usbdirect', device: 'POS-80' }, 'VALIDATION');
    h.fail('UpsertPrinter', { id: newId(), name: 'x', transport: 'serial', device: 'COM5;calc' }, 'VALIDATION');
    h.fail('UpsertPrinter', { id: newId(), name: 'x', transport: 'serial', device: 'COM5:1234' }, 'VALIDATION');
  });

  it('the cash drawer is only for printers that print bills', () => {
    const id = newId();
    h.run('UpsertPrinter', { id, name: 'Kitchen', transport: 'fake', role: 'kot', drawer: true });
    expect(h.db.prepare('SELECT drawer FROM printer WHERE id = ?').pluck().get(id)).toBe(0);
  });

  it('stationIds sets which stations print on it, from the printer; a bill-only printer prints no KOTs; left out keeps them', () => {
    const kitchen = station('Kitchen');
    const bar = station('Bar');
    const id = newId();
    const links = () => h.db.prepare('SELECT station_id FROM station_printer WHERE printer_id = ? ORDER BY station_id').pluck().all(id);
    h.run('UpsertPrinter', { id, name: 'Kitchen printer', transport: 'fake', stationIds: [kitchen, bar] });
    expect(links()).toEqual([kitchen, bar].sort());
    h.run('UpsertPrinter', { id, name: 'Kitchen printer', transport: 'fake' });
    expect(links()).toHaveLength(2);
    h.run('UpsertPrinter', { id, name: 'Kitchen printer', transport: 'fake', stationIds: [bar] });
    expect(links()).toEqual([bar]);
    h.run('UpsertPrinter', { id, name: 'Kitchen printer', transport: 'fake', role: 'bill', stationIds: [bar] });
    expect(links()).toEqual([]);
    h.fail('UpsertPrinter', { id, name: 'Kitchen printer', transport: 'fake', stationIds: [newId()] }, 'NOT_FOUND');
  });

  it('turning a printer off moves what was waiting for it to failed (the print alarm offers it again)', () => {
    const id = newId();
    h.run('UpsertPrinter', { id, name: 'Kitchen', transport: 'fake' });
    job(id, 'queued');
    job(id, 'retry');
    job(id, 'done');
    const res = h.run('UpsertPrinter', { id, name: 'Kitchen', transport: 'fake', active: false });
    expect(res.result).toMatchObject({ released: 2 });
    expect(h.db.prepare('SELECT state, last_error FROM print_job WHERE printer_id = ? ORDER BY state').all(id)).toEqual([
      { state: 'done', last_error: null },
      { state: 'failed', last_error: 'The printer was turned off.' },
      { state: 'failed', last_error: 'The printer was turned off.' },
    ]);
    h.fail('PrintTestPage', { printerId: id }, 'INVALID_STATE');
  });
});

describe('RemovePrinter', () => {
  const h = useHarness();
  it('a printer that never printed is deleted with what points at it; one with history is turned off instead', () => {
    const a = newId();
    const b = newId();
    const s = newId();
    h.run('UpsertPrinter', { id: a, name: 'Counter', transport: 'fake', role: 'bill' });
    h.run('UpsertPrinter', { id: b, name: 'Kitchen', transport: 'fake', backupPrinterId: a });
    h.run('UpsertStation', { id: s, name: 'Kitchen', printerIds: [a, b] });
    h.run('SetConfig', { values: { 'bill.printerId': a } });
    expect(h.run('RemovePrinter', { printerId: a }).result).toEqual({ removed: true, turnedOff: false });
    expect(h.count('printer', `id = '${a}'`)).toBe(0);
    expect(h.db.prepare('SELECT backup_printer_id FROM printer WHERE id = ?').pluck().get(b)).toBeNull();
    expect(h.db.prepare('SELECT printer_id FROM station_printer WHERE station_id = ?').pluck().all(s)).toEqual([b]);
    expect(h.count('config', "key = 'bill.printerId'")).toBe(0);

    h.run('PrintTestPage', { printerId: b });
    expect(h.run('RemovePrinter', { printerId: b }).result).toEqual({ removed: false, turnedOff: true });
    expect(h.db.prepare('SELECT active FROM printer WHERE id = ?').pluck().get(b)).toBe(0);
    h.fail('RemovePrinter', { printerId: newId() }, 'NOT_FOUND');
  });
  it('FORBIDDEN without admin', () => {
    h.fail('RemovePrinter', { printerId: newId() }, 'FORBIDDEN', { rights: denyAll });
  });
});
