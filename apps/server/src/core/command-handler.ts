import type { Right } from '@dinepos/shared';
import type { z } from 'zod';
import type { CommandContext } from './context.js';

/** Row of the `"order"` table as loaded by the pipeline. */
export interface OrderRow {
  id: string;
  business_date: string;
  table_id: string | null;
  type: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  covers: number | null;
  captain_id: string | null;
  state: 'open' | 'billed' | 'settled' | 'void' | 'merged';
  merged_into: string | null;
  version: number;
  opened_at: string;
  last_kot_at: string | null;
  bill_printed_at: string | null;
  closed_at: string | null;
}

export interface HandlerResult<R = unknown> {
  result?: R;
  /** Set by commands that create an order (OpenTable, NewTakeaway); its snapshot is returned. */
  orderId?: string;
}

export interface CommandHandler<P = unknown, R = unknown> {
  type: string;
  schema: z.ZodType<P>;
  /** Right required (docs/03 Right column); null only for commands any signed-in user may send. */
  right: Right | null;
  /** True: envelope must carry orderId + expectedVersion; the order is loaded and version-checked. */
  needsOrder: boolean;
  /** Commands that may run with no open business date (DayEnd's successor, admin setup). */
  allowWhenDayClosed?: boolean;
  /**
   * P4-06: sent only by the server itself (the order-hub connector), never over /v1/commands. They still run through
   * the same pipeline (one transaction, audit, events) as every other write.
   */
  internal?: boolean;
  apply(ctx: CommandContext, payload: P, order: OrderRow | null): HandlerResult<R> | void;
}

export type CommandRegistry = ReadonlyMap<string, CommandHandler<unknown, unknown>>;

/** Typed helper so handler files keep their payload type. */
export function defineCommand<P, R = unknown>(handler: CommandHandler<P, R>): CommandHandler<P, R> {
  return handler;
}

export function createRegistry(handlers: readonly CommandHandler<unknown, unknown>[]): CommandRegistry {
  const map = new Map<string, CommandHandler<unknown, unknown>>();
  for (const h of handlers) {
    if (map.has(h.type)) throw new Error(`command ${h.type} registered twice`);
    map.set(h.type, h);
  }
  return map;
}
