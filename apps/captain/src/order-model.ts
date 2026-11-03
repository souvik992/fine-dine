// Pure order-screen logic for the phone (no React): the held basket by course and what "Fire" can send.
import { cartLineAmount } from '@dinepos/client';
import type { OrderItemSnapshot } from '@dinepos/shared';

/** Courses a captain can tag a line with on the phone (the API allows 1–9; five covers a tasting menu). */
export const COURSES = [1, 2, 3, 4, 5] as const;

export interface CourseGroup {
  course: number;
  items: OrderItemSnapshot[];
  /** Portions in this course (sum of qty). */
  qty: number;
  amountPaise: number;
}

/** Lines not sent yet, grouped by course (lowest first), in the order they were added. */
export function heldByCourse(items: readonly OrderItemSnapshot[]): CourseGroup[] {
  const groups = new Map<number, OrderItemSnapshot[]>();
  for (const i of items) if (i.status === 'held') groups.set(i.course, [...(groups.get(i.course) ?? []), i]);
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([course, list]) => ({
      course,
      items: list,
      qty: list.reduce((n, i) => n + i.qty, 0),
      amountPaise: list.reduce((n, i) => n + cartLineAmount(i), 0),
    }));
}

/** What the basket bar shows: portions waiting to be sent and their amount before tax. */
export function heldSummary(items: readonly OrderItemSnapshot[]): { qty: number; amountPaise: number } {
  return heldByCourse(items).reduce((s, g) => ({ qty: s.qty + g.qty, amountPaise: s.amountPaise + g.amountPaise }), { qty: 0, amountPaise: 0 });
}

/**
 * The fire buttons: "Fire all" whenever anything is held, plus one per course when more than one course is
 * waiting (with a single course, "Fire all" is the same thing).
 */
export function fireChoices(items: readonly OrderItemSnapshot[]): Array<{ label: string; payload: { all: true } | { course: number }; qty: number }> {
  const groups = heldByCourse(items);
  if (groups.length === 0) return [];
  const all = { label: 'Fire all', payload: { all: true as const }, qty: groups.reduce((n, g) => n + g.qty, 0) };
  if (groups.length === 1) return [all];
  return [all, ...groups.map((g) => ({ label: `Fire course ${g.course}`, payload: { course: g.course }, qty: g.qty }))];
}

export const kotText = (kotNo: number) => `KOT ${String(kotNo).padStart(4, '0')}`;

/** "KOT 0012 sent" / "KOT 0012, 0013 sent" from a FireKOT result (one KOT per kitchen station). */
export function firedMessage(result: { kots?: Array<{ kotNo: number }> } | undefined): string {
  const nos = (result?.kots ?? []).map((k) => String(k.kotNo).padStart(4, '0'));
  return nos.length ? `KOT ${nos.join(', ')} sent to the kitchen.` : 'Sent to the kitchen.';
}
