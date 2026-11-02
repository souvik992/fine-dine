import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

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
