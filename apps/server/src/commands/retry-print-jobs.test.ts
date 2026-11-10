import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFailedPrintJobs } from '../queries/print-jobs.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// The print alarm: failed tickets are listed for the terminals and can be sent again as they were.
describe('failed print jobs and RetryPrintJobs', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let kotJob: string;
  const fail = (id: string, at = TEST_NOW()) =>
    h.db.prepare("UPDATE print_job SET state = 'failed', attempts = 4, last_error = 'connect ECONNREFUSED', done_at = ? WHERE id = ?").run(at.toISOString(), id);
  beforeEach(() => {
    seedOutlet(h);
    const orderId = o.open(S.t1, 2).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { note: 'no cream' })] });
    o.run('FireKOT', orderId, { all: true });
    kotJob = h.db.prepare("SELECT id FROM print_job WHERE doc_kind = 'kot' LIMIT 1").pluck().get() as string;
  });

  it('lists a failed KOT with its printer, KOT number and table; a printed one is not listed', () => {
    expect(getFailedPrintJobs(h.db, TEST_NOW())).toEqual([]);
    fail(kotJob);
    const [job, ...rest] = getFailedPrintJobs(h.db, TEST_NOW());
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ id: kotJob, printerName: 'Kitchen printer', docKind: 'kot', error: 'connect ECONNREFUSED' });
    expect(job!.label).toMatch(/^KOT 0001 · Table \S+$/);
  });

  it('only failures from the last 30 minutes ring', () => {
    fail(kotJob);
    h.db.prepare('UPDATE print_job SET created_at = ? WHERE id = ?').run(new Date(TEST_NOW().getTime() - 31 * 60_000).toISOString(), kotJob);
    expect(getFailedPrintJobs(h.db, TEST_NOW())).toEqual([]);
  });

  it('retry queues the same ticket again (same bytes, no DUPLICATE mark); the failed one stops ringing; audited', () => {
    fail(kotJob);
    const res = h.run('RetryPrintJobs', { jobIds: [kotJob] });
    const { jobs } = res.result as { jobs: Array<{ jobId: string; newJobId: string }> };
    expect(jobs).toHaveLength(1);
    const [before, after] = [kotJob, jobs[0]!.newJobId].map((id) => h.db.prepare('SELECT printer_id, doc_kind, ref_id, bytes, preview_text, state FROM print_job WHERE id = ?').get(id) as Record<string, unknown>);
    expect(after).toMatchObject({ printer_id: before!.printer_id, doc_kind: 'kot', ref_id: before!.ref_id, preview_text: before!.preview_text, state: 'queued' });
    expect(Buffer.compare(after!.bytes as Buffer, before!.bytes as Buffer)).toBe(0);
    expect(String(after!.preview_text)).not.toContain('DUPLICATE');
    expect(getFailedPrintJobs(h.db, TEST_NOW())).toEqual([]);
    expect(h.count('audit_event', "action = 'print.retry'")).toBe(1);
    // the copy rings itself if it fails too
    fail(jobs[0]!.newJobId);
    expect(getFailedPrintJobs(h.db, TEST_NOW()).map((j) => j.id)).toEqual([jobs[0]!.newJobId]);
  });

  it('a job copied to the backup printer does not ring (its copy is the job now)', () => {
    fail(kotJob);
    h.db.prepare("INSERT INTO audit_event (ts, entity, entity_id, action, before_json, after_json, reason) VALUES (?, 'print_job', ?, 'print.reroute', '{}', '{}', 'down')").run(TEST_NOW().toISOString(), kotJob);
    expect(getFailedPrintJobs(h.db, TEST_NOW())).toEqual([]);
  });

  it('NOT_FOUND, INVALID_STATE (not failed, already sent again), FORBIDDEN; a replay sends nothing more', () => {
    h.fail('RetryPrintJobs', { jobIds: [newId()] }, 'NOT_FOUND');
    expect(h.fail('RetryPrintJobs', { jobIds: [kotJob] }, 'INVALID_STATE').message).toMatch(/did not print/);
    fail(kotJob);
    expect(h.fail('RetryPrintJobs', { jobIds: [kotJob] }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'kot.fire' });
    const commandId = newId();
    h.run('RetryPrintJobs', { jobIds: [kotJob] }, { commandId });
    expect(h.run('RetryPrintJobs', { jobIds: [kotJob] }, { commandId }).duplicate).toBe(true);
    expect(h.count('print_job', "doc_kind = 'kot'")).toBe(2);
    expect(h.fail('RetryPrintJobs', { jobIds: [kotJob] }, 'INVALID_STATE').message).toMatch(/already sent again/);
  });
});
