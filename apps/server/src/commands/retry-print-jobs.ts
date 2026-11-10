import { PosError } from '../core/errors.js';
import { defineCommand } from '../core/command-handler.js';
import { retryPrintJobsSchema } from '@dinepos/shared';

/**
 * The print alarm's Retry: each failed job is queued again on its own printer, exactly as it was (no DUPLICATE mark:
 * it never printed). The failed job keeps its history; a `print.retry` audit row links it to the new job, so it no
 * longer rings (the new job rings itself if it fails too). Not a reprint: no leakage flag, no PIN.
 */
export const retryPrintJobs = defineCommand({
  type: 'RetryPrintJobs',
  schema: retryPrintJobsSchema,
  right: 'kot.fire',
  needsOrder: false,
  apply(ctx, p) {
    const { db } = ctx;
    const get = db.prepare('SELECT id, printer_id, doc_kind, ref_id, bytes, preview_text, state FROM print_job WHERE id = ?');
    const retried = db.prepare("SELECT 1 FROM audit_event WHERE entity = 'print_job' AND entity_id = ? AND action IN ('print.retry', 'print.reroute')");
    const jobs = [...new Set(p.jobIds)].map((id) => {
      const job = get.get(id) as
        | { id: string; printer_id: string; doc_kind: 'kot' | 'bill' | 'zreport' | 'drawer' | 'test'; ref_id: string | null; bytes: Buffer; preview_text: string | null; state: string }
        | undefined;
      if (!job) throw new PosError('NOT_FOUND', 'That print job is not there any more.', { jobId: id });
      if (job.state !== 'failed') throw new PosError('INVALID_STATE', 'Only a ticket that did not print can be sent again.', { jobId: id, state: job.state });
      if (retried.get(id)) throw new PosError('INVALID_STATE', 'That ticket was already sent again.', { jobId: id });
      return job;
    });
    const sent = jobs.map((job) => {
      const newJobId = ctx.print({ printerId: job.printer_id, docKind: job.doc_kind, refId: job.ref_id, bytes: new Uint8Array(job.bytes), previewText: job.preview_text });
      ctx.audit({ entity: 'print_job', entityId: job.id, action: 'print.retry', after: { printerId: job.printer_id, jobId: newJobId } });
      return { jobId: job.id, newJobId };
    });
    ctx.emit('printers', 'print.retry', { jobs: sent });
    return { result: { jobs: sent } };
  },
});
