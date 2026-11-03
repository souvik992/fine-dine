// Cloud sync (P4-05, docs/05 "Cloud sync"): the outlet's outbox sent up to the hub, licence renewals fetched down.
import { z } from 'zod';

/** Internal: what the hub holds of this outlet's stream. Rows up to ackSeq are sent; with `rewind`, later ones are not. */
export const recordSyncAckSchema = z
  .object({ streamId: z.string().regex(/^[0-9A-Za-z]{16,64}$/), ackSeq: z.number().int().min(0), rewind: z.boolean().default(false) })
  .strict();

/** Admin: start a new stream after the hub refused records it holds differently (this database was restored). */
export const resetSyncStreamSchema = z.object({}).strict();

/** Internal: a renewed licence key fetched from the hub. */
export const renewLicenceSchema = z.object({ key: z.string().trim().min(40).max(4000) }).strict();

export interface SyncStatus {
  /** paired with the hub (Settings › Online orders); sync uses the same link */
  paired: boolean;
  hubUrl: string | null;
  store: { slug: string; name: string } | null;
  /** idle: nothing to send; sending; offline: the hub could not be reached (retrying); stuck: the hub refused (see lastError) */
  state: 'not-paired' | 'idle' | 'sending' | 'offline' | 'stuck';
  pending: number;
  oldestPendingAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** the hub holds different records under numbers this outlet sent: start a new stream (ResetSyncStream) */
  conflict: boolean;
  licence: { checkedAt: string | null; result: string | null };
}
