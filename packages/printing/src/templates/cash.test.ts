import { describe, expect, it } from 'vitest';
import { renderCashSlip } from './cash.js';

describe('cash slips (P2-06)', () => {
  it('a pay-out slip has the amount, reason, who and a line to sign, and opens the drawer', () => {
    const r = renderCashSlip({ kind: 'pay_out', outletName: 'Spice Garden', amountPaise: 50_000, reason: 'Milk from the market', by: 'Meena', at: '03-11-26 11:05' }, { paper: 58 });
    expect(r.preview).toContain('CASH PAID OUT');
    expect(r.preview).toContain('Rs 500.00');
    expect(r.preview).toContain('Reason: Milk from the market');
    expect(r.preview).toContain('Received by:');
    const b = Array.from(r.bytes);
    expect(b.findIndex((x, i) => x === 0x1b && b[i + 1] === 0x70)).toBeGreaterThan(-1); // ESC p: drawer kick
  });

  it('a drawer slip has no amount', () => {
    expect(renderCashSlip({ kind: 'drawer', outletName: 'X', reason: 'Change for a note', by: null, at: '03-11-26 11:05' }, { paper: 80 }).preview).not.toContain('Amount');
  });
});
