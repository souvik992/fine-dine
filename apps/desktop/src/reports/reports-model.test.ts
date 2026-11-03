import { describe, expect, it } from 'vitest';
import { presetRange } from './ReportsScreen.js';

describe('report date presets', () => {
  it('count back from the business date', () => {
    expect(presetRange('today', '2026-11-03')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(presetRange('yesterday', '2026-11-01')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(presetRange('week', '2026-11-03')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    expect(presetRange('month', '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-03' });
  });
});
