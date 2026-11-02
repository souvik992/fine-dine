// Money is INTEGER PAISE everywhere; rates are INTEGER BASIS POINTS (500 = 5%). No floats, ever.
// Products go through BigInt so a large bill can never lose precision. (Adapted from Tiffin POS core/money.)

export const BP_DENOMINATOR = 10_000;

/** Throws unless `n` is a safe integer. Every helper checks inputs and outputs with this. */
export function assertInt(n: number, label = 'value'): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer, got ${String(n)}`);
}

export function assertNonNegative(n: number, label = 'value'): void {
  assertInt(n, label);
  if (n < 0) throw new RangeError(`${label} must not be negative, got ${n}`);
}

function toSafe(b: bigint, label: string): number {
  const n = Number(b);
  if (!Number.isSafeInteger(n) || BigInt(n) !== b) throw new RangeError(`${label} overflows a safe integer`);
  return n;
}

function roundBig(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('denominator must be positive');
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return neg ? -q : q;
}

/**
 * `numerator / denominator` rounded half up (half away from zero for negatives, so a refund rounds
 * the same as the sale it reverses). Integers in, integer out.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  assertInt(numerator, 'numerator');
  assertInt(denominator, 'denominator');
  return toSafe(roundBig(BigInt(numerator), BigInt(denominator)), 'roundHalfUp');
}

/** `a × b / c` rounded half up, with a BigInt intermediate so `a × b` cannot overflow. */
export function mulDivRound(a: number, b: number, c: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(c, 'c');
  return toSafe(roundBig(BigInt(a) * BigInt(b), BigInt(c)), 'mulDivRound');
}

/** `amount × rateBp / 10000`, rounded half up. */
export function applyRate(amountPaise: number, rateBp: number): number {
  return mulDivRound(amountPaise, rateBp, BP_DENOMINATOR);
}

/** `unitPrice × qty`, checked. */
export function multiplyPaise(unitPricePaise: number, qty: number): number {
  assertInt(unitPricePaise, 'unitPricePaise');
  assertInt(qty, 'qty');
  return toSafe(BigInt(unitPricePaise) * BigInt(qty), 'multiplyPaise');
}

export function sumPaise(values: readonly number[]): number {
  let s = 0n;
  for (const v of values) {
    assertInt(v, 'amount');
    s += BigInt(v);
  }
  return toSafe(s, 'sumPaise');
}

/**
 * Splits `total` across `weights` so the parts sum EXACTLY to `total` (largest-remainder / Hamilton).
 * Each part gets floor(total × w / W); the leftover paise go to the largest remainders, ties to the
 * lowest index. Zero weights get nothing. A negative total is split like its absolute value, negated.
 */
export function allocateLargestRemainder(total: number, weights: readonly number[]): number[] {
  assertInt(total, 'total');
  let weightSum = 0n;
  for (const w of weights) {
    assertNonNegative(w, 'weight');
    weightSum += BigInt(w);
  }
  const out = weights.map(() => 0);
  if (total === 0) return out;
  if (weightSum === 0n) throw new RangeError('cannot allocate over weights that sum to zero');

  const sign = total < 0 ? -1 : 1;
  const t = BigInt(Math.abs(total));
  const remainders: bigint[] = [];
  let allocated = 0n;
  weights.forEach((w, i) => {
    const num = t * BigInt(w);
    const share = num / weightSum;
    out[i] = Number(share);
    remainders[i] = num % weightSum;
    allocated += share;
  });
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (remainders[b]! > remainders[a]! ? 1 : remainders[b]! < remainders[a]! ? -1 : a - b));
  for (let k = 0n, left = t - allocated; k < left; k++) out[order[Number(k)]!]! += 1;
  return sign === 1 ? out : out.map((v) => (v === 0 ? 0 : -v));
}

export type RoundOffStep = 0 | 50 | 100;
export type RoundOffTie = 'up' | 'down';

/**
 * Rounds a bill amount to the nearest `step` paise (0 = no rounding). `tie` decides an exact half:
 * 'up' → ₹101.50 becomes ₹102, 'down' → ₹101. Returns the signed adjustment, |adj| ≤ step / 2.
 */
export function roundOff(amountPaise: number, step: RoundOffStep, tie: RoundOffTie = 'up'): number {
  assertInt(amountPaise, 'amount');
  if (step === 0) return 0;
  const rem = ((amountPaise % step) + step) % step;
  const half = step / 2;
  if (rem === 0) return 0;
  if (rem > half || (rem === half && tie === 'up')) return step - rem;
  return -rem;
}

/** Formats paise with Indian digit grouping: 12345678 → "₹1,23,456.78". */
export function formatINR(paise: number, symbol = '₹'): string {
  assertInt(paise, 'paise');
  const abs = Math.abs(paise);
  let rupees = String(Math.floor(abs / 100));
  if (rupees.length > 3) {
    rupees = `${rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${rupees.slice(-3)}`;
  }
  return `${paise < 0 ? '-' : ''}${symbol}${rupees}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parses typed rupees ("120", "120.5", "1,20,000.75") into paise without floats. */
export function parseRupees(input: string): number {
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ''));
  if (!m) throw new RangeError(`not a rupee amount: "${input}"`);
  return multiplyPaise(Number(m[1]), 100) + Number((m[2] ?? '').padEnd(2, '0'));
}
