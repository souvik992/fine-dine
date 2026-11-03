import { z } from 'zod';
import { defineCommand } from '../core/command-handler.js';
import { requireOnline, setOnlineState } from '../online/online-support.js';

const noteOnlineOrderSchema = z.object({ onlineOrderId: z.string().min(1).max(100), alert: z.string().max(300) }).strict();

/** Internal (P4-06): something staff must know about an online order (e.g. why it was not accepted automatically). */
export const noteOnlineOrder = defineCommand({
  type: 'NoteOnlineOrder',
  schema: noteOnlineOrderSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    const o = requireOnline(ctx, p.onlineOrderId);
    setOnlineState(ctx, o.id, o.state, { alert: p.alert });
    return { result: { noted: true } };
  },
});
