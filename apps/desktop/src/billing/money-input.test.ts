import { describe, expect, it } from 'vitest';
import { percentToBp, rupeesToPaise } from './money-input.js';

describe('money input', () => {
  it('reads rupees into paise without floats', () => {
    expect(rupeesToPaise('120')).toBe(12_000);
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise('1,200.75')).toBe(120_075);
    expect(rupeesToPaise('')).toBe(0);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });

  it('reads percentages into basis points', () => {
    expect(percentToBp('10')).toBe(1_000);
    expect(percentToBp('12.5')).toBe(1_250);
    expect(percentToBp('2.25%')).toBe(225);
    expect(percentToBp('100')).toBe(10_000);
    expect(percentToBp('100.5')).toBeNull();
    expect(percentToBp('-5')).toBeNull();
    expect(percentToBp('')).toBe(0);
  });
});

describe('formatting for inputs', () => {
  it('uses integer maths only', async () => {
    const { paiseToInput, bpToPercentText } = await import('./money-input.js');
    expect(paiseToInput(38_250)).toBe('382.50');
    expect(paiseToInput(5)).toBe('0.05');
    expect(bpToPercentText(1_000)).toBe('10');
    expect(bpToPercentText(1_250)).toBe('12.5');
  });
});
