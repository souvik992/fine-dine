import { createHash } from 'node:crypto';
import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrinters } from '../queries/printers.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { S, seedOutlet } from '../testing/order-fixture.js';

// P6-03: print agents. The key is made on the terminal; only its hash is stored. Printers can be assigned to an agent.
describe('print agents', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));
  const hash = (key: string) => createHash('sha256').update(`agent:${key}`).digest('hex');
  const agent = (name = 'Kitchen PC', key = 'pa_test-key-0123456789abcdef') => {
    const id = newId();
    h.run('CreatePrintAgent', { id, name, keyHash: hash(key) });
    return id;
  };

  it('creates an agent with only the key’s hash; assigns a printer; the printers list says which agent prints it', () => {
    const id = agent();
    expect(h.db.prepare('SELECT name, key_hash FROM print_agent WHERE id = ?').get(id)).toEqual({ name: 'Kitchen PC', key_hash: hash('pa_test-key-0123456789abcdef') });
    expect(JSON.stringify(h.db.prepare('SELECT result_json FROM processed_command').pluck().all())).not.toContain('pa_test-key');
    h.run('SetPrinterAgent', { printerId: S.kitchenPrinter, agentId: id });
    expect(getPrinters(h.db, undefined, TEST_NOW()).find((p) => p.id === S.kitchenPrinter)!.agent).toEqual({ id, name: 'Kitchen PC' });
    h.run('SetPrinterAgent', { printerId: S.kitchenPrinter, agentId: null });
    expect(getPrinters(h.db, undefined, TEST_NOW()).find((p) => p.id === S.kitchenPrinter)!.agent).toBeUndefined();
    expect(h.count('audit_event', "action IN ('print_agent.create', 'printer.agent')")).toBe(3);
  });

  it('removing an agent stops its key and gives its printers back to the server', () => {
    const id = agent();
    h.run('SetPrinterAgent', { printerId: S.kitchenPrinter, agentId: id });
    expect(h.run('RevokePrintAgent', { agentId: id }).result).toEqual({ printers: [S.kitchenPrinter] });
    expect(h.db.prepare('SELECT count(*) FROM printer_agent').pluck().get()).toBe(0);
    h.fail('RevokePrintAgent', { agentId: id }, 'INVALID_STATE');
    expect(h.fail('SetPrinterAgent', { printerId: S.kitchenPrinter, agentId: id }, 'INVALID_STATE').message).toMatch(/removed/);
  });

  it('NOT_FOUND / INVALID_STATE / FORBIDDEN; a replay changes nothing more', () => {
    h.fail('SetPrinterAgent', { printerId: newId(), agentId: null }, 'NOT_FOUND');
    h.fail('SetPrinterAgent', { printerId: S.kitchenPrinter, agentId: newId() }, 'NOT_FOUND');
    h.fail('RevokePrintAgent', { agentId: newId() }, 'NOT_FOUND');
    const id = agent();
    expect(h.fail('CreatePrintAgent', { id, name: 'Again', keyHash: hash('other-key-0123456789abc') }, 'INVALID_STATE').message).toMatch(/already exists/);
    expect(h.fail('CreatePrintAgent', { id: newId(), name: 'Bar PC', keyHash: hash('k-0123456789abcdefghij') }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'admin' });
    const commandId = newId();
    const payload = { id: newId(), name: 'Bar PC', keyHash: hash('bar-key-0123456789abcdef') };
    h.run('CreatePrintAgent', payload, { commandId });
    expect(h.run('CreatePrintAgent', payload, { commandId }).duplicate).toBe(true);
    expect(h.db.prepare('SELECT count(*) FROM print_agent').pluck().get()).toBe(2);
  });
});
