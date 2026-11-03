// Pure kitchen-screen logic (tested): ticket age and colour, the two columns, courses, and the all-day counts.
import type { KdsBoard, KdsTicket, KdsTicketLine } from '@dinepos/shared';

export type AgeLevel = 'ok' | 'amber' | 'red';

/** Whole seconds since the ticket was fired, on the server's clock (`offsetMs` = server − this screen). */
export function ageSeconds(ticket: Pick<KdsTicket, 'firedAt'>, nowMs: number, offsetMs: number): number {
  return Math.max(0, Math.floor((nowMs + offsetMs - Date.parse(ticket.firedAt)) / 1000));
}

/** "4:07", "12:30", "1:05:00". */
export function ageText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** docs/06: amber from `amberMin`, red from `redMin`. A ready ticket keeps the colour it had when it was bumped. */
export function ageLevel(seconds: number, board: Pick<KdsBoard, 'amberMin' | 'redMin'>): AgeLevel {
  const min = seconds / 60;
  return min >= board.redMin ? 'red' : min >= board.amberMin ? 'amber' : 'ok';
}

/** A card on the screen: a ticket and the change slips that belong to it (docs/06: "attach to the original ticket"). */
export interface Card {
  ticket: KdsTicket;
  slips: KdsTicket[];
}

/**
 * Change slips (CHANGED / CANCELLED) sit on the ticket they change when it is still on the screen; otherwise (the
 * original already went out) they are a card of their own.
 */
export function cards(tickets: readonly KdsTicket[]): Card[] {
  const byNo = new Map(tickets.filter((t) => t.kind === 'new').map((t) => [`${t.orderId}:${t.kotNo}`, t]));
  const attached = new Map<string, KdsTicket[]>();
  const out: Card[] = [];
  for (const t of tickets) {
    const original = (t.kind === 'modify' || t.kind === 'cancel') && t.forKotNo ? byNo.get(`${t.orderId}:${t.forKotNo}`) : undefined;
    if (original) attached.set(original.id, [...(attached.get(original.id) ?? []), t]);
  }
  for (const t of tickets) {
    const isAttached = [...attached.values()].some((list) => list.includes(t));
    if (!isAttached) out.push({ ticket: t, slips: attached.get(t.id) ?? [] });
  }
  return out;
}

/** New (to cook) and Ready (to go out), oldest first in each; a card goes by its ticket. */
export function columns(tickets: readonly KdsTicket[]): { fresh: Card[]; ready: Card[] } {
  const all = cards(tickets);
  return { fresh: all.filter((c) => !c.ticket.readyAt), ready: all.filter((c) => c.ticket.readyAt) };
}

/** The tickets one bump acts on: the card's ticket, then its slips that are not there yet. */
export function bumpTargets(card: Card, action: 'ready' | 'served' | 'recall'): KdsTicket[] {
  const slips = card.slips.filter((s) => (action === 'ready' ? !s.readyAt : action === 'recall' ? !!s.readyAt : true));
  return [card.ticket, ...slips];
}

/** Lines grouped by course, in course order; a single course is not labelled. */
export function byCourse(lines: readonly KdsTicketLine[]): Array<{ course: number; lines: KdsTicketLine[] }> {
  const map = new Map<number, KdsTicketLine[]>();
  for (const l of lines) map.set(l.course, [...(map.get(l.course) ?? []), l]);
  return [...map.entries()].sort(([a], [b]) => a - b).map(([course, ls]) => ({ course, lines: ls }));
}

/**
 * All-day counts (docs/06 side panel): how many of each dish the station still has to cook, across the tickets not
 * yet ready. Change slips count too (a "-1" takes one off); dishes that come to nothing are left out.
 */
export function allDay(tickets: readonly KdsTicket[]): Array<{ name: string; qty: number }> {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    if (t.readyAt || t.kind === 'move_notice') continue;
    for (const l of t.lines) counts.set(l.name, (counts.get(l.name) ?? 0) + l.qty);
  }
  return [...counts.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

export const KIND_LABEL: Record<KdsTicket['kind'], string | null> = { new: null, modify: 'CHANGED', cancel: 'CANCELLED', move_notice: 'TABLE MOVED' };

/** The station the screen shows: `?station=` in the address wins, then the one chosen before. */
export function chosenStation(search: string, saved: string | null): string | null {
  return new URLSearchParams(search).get('station') || saved || null;
}
