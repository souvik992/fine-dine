// Table QR add-on, server side (P5-02, P5-04). Runs inside the DinePOS server through the add-on host (ADR-0004):
// its own tables (tableqr_*), its own commands (TableQr*), staff routes under /v1/addons/tableqr and the guest page
// and API under /a/tableqr. Food reaches the kitchen only through DinePOS's own commands (OpenTable, AddItems,
// FireKOT), with the staff member who accepted, or the add-on's own actor when the outlet chose automatic accepting.
import { createHash, randomBytes } from 'node:crypto';
import type { MenuItem, MenuSnapshot, OrderSnapshot } from '@dinepos/shared';
import { z } from 'zod';
import { badgesFor, checkOrder, codeBase, guestUrl, readSettings, stableId, upiLink, type CheckedLine, type QrSettings, type RequestKind, type RequestStatus } from './logic.js';

// ---- the host (apps/server/src/addons/loader.ts); only what this add-on uses ----
interface Actor {
  deviceId: string | null;
  userId: string | null;
  deviceKind?: string | null;
}
interface Ctx {
  db: { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } };
  commandId: string;
  actor: Actor;
  nowIso: string;
  audit(e: { entity: string; entityId?: string | null; action: string; before?: unknown; after?: unknown; reason?: string | null }): void;
  emit(topics: string | string[], event: string, data: unknown): void;
}
interface Req {
  actor: Actor | null;
  body: unknown;
  query: Record<string, string>;
  params: Record<string, string>;
  ip: string;
}
interface Success {
  result: unknown;
  duplicate?: true;
}
interface Host {
  id: string;
  now(): Date;
  log: { info(m: string, d?: unknown): void; warn(m: string, d?: unknown): void };
  PosError: new (code: string, message: string, details?: unknown) => Error;
  db: { get<T>(sql: string, ...p: unknown[]): T | undefined; all<T>(sql: string, ...p: unknown[]): T[] };
  migrations(steps: string[]): void;
  command(def: { type: string; schema: unknown; right: string | null; internal?: boolean; allowWhenDayClosed?: boolean; apply(ctx: Ctx, payload: never): { result?: unknown } | void }): void;
  route(method: 'GET' | 'POST', path: string, handler: (req: Req) => unknown, opts: { access: 'staff' | 'guest'; right?: string | null }): void;
  static(urlPath: string, file: string): void;
  file(type: string, bytes: Uint8Array): unknown;
  floorBadges(fn: (db: Host['db']) => Array<{ tableId: string; key: string; label: string; tone: 'info' | 'warn' | 'alert' }>): void;
  execute(type: string, payload: unknown, opts: { actor: Actor; commandId?: string; orderId?: string }): Success;
  executeOnce(commandId: string, type: string, payload: unknown, opts: { actor: Actor; orderId?: string }): Success;
  systemActor(): Actor;
  menu(): MenuSnapshot;
  order(orderId: string): OrderSnapshot | null;
  config(): Record<string, string | number | boolean | null | string[]>;
  network(): { addresses: string[]; port: number };
  /** DinePOS with P5-03 (older ones: Wi-Fi codes only). */
  hub?(): { url: string; storeSlug: string; connected: boolean } | null;
  hubAccess?(fn: () => boolean): void;
}

const MIGRATIONS = [
  `CREATE TABLE tableqr_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE tableqr_table (table_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
   CREATE TABLE tableqr_request (
     id TEXT PRIMARY KEY,
     table_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('order', 'waiter', 'pay')),
     status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'done')),
     guest_id TEXT,
     items_json TEXT,
     covers INTEGER,
     note TEXT,
     amount_paise INTEGER,
     bill_id TEXT,
     order_id TEXT,
     reason TEXT,
     created_at TEXT NOT NULL,
     handled_at TEXT,
     handled_by TEXT
   );
   CREATE INDEX tableqr_request_open ON tableqr_request (status, table_id);
   CREATE INDEX tableqr_request_guest ON tableqr_request (guest_id, created_at);`,
];

/** How long a guest's waiting request still counts (older ones are from an earlier service and are not shown). */
const LIVE_HOURS = 12;
const MAX_PENDING_PER_TABLE = 5;

const id26 = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const guestId = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    acceptMode: z.enum(['staff', 'auto']),
    payOnline: z.boolean(),
    baseUrl: z.union([z.literal(''), z.string().trim().max(200).regex(/^https?:\/\/[^\s/?#]+(:\d+)?\/?$/, 'Use an address such as http://192.168.1.20:7420')]),
    codeAddress: z.enum(['wifi', 'hub']).default('wifi'),
    welcome: z.string().trim().max(200),
  })
  .strict();
const codesSchema = z.object({ tableIds: z.array(id26).max(500).optional(), renew: z.boolean().default(false) }).strict();
const lineSchema = z
  .object({ itemId: id26, variantId: id26.nullable().optional(), addonIds: z.array(id26).max(20).optional(), qty: z.number().int().min(1).max(20), note: z.string().max(100).nullable().optional() })
  .strict();
const guestRequestSchema = z
  .object({
    tableId: id26,
    kind: z.enum(['order', 'waiter', 'pay']),
    guestId,
    lines: z.array(z.object({ itemId: id26, variantId: id26.nullable(), addons: z.array(z.object({ addonId: id26, qty: z.number().int() })), qty: z.number().int(), note: z.string().nullable(), label: z.string(), amountPaise: z.number().int() })).max(30).optional(),
    covers: z.number().int().min(1).max(99).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
    amountPaise: z.number().int().min(0).nullable().optional(),
    billId: id26.nullable().optional(),
  })
  .strict();
const resolveSchema = z
  .object({ requestId: id26, status: z.enum(['accepted', 'rejected', 'done']), reason: z.string().trim().max(120).nullable().optional(), orderId: id26.nullable().optional() })
  .strict();

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown) => (typeof v === 'string' ? v : '');

export function register(host: Host): void {
  host.migrations(MIGRATIONS);
  const fail = (code: string, message: string, details?: unknown): never => {
    throw new host.PosError(code, message, details);
  };
  const reqId = (v: unknown): string => {
    const r = id26.safeParse(v);
    return r.success ? r.data : fail('NOT_FOUND', 'This request is no longer there.');
  };

  // ------------------------------------------------------------------ commands (the only writes)

  host.command({
    type: 'TableQrSaveSettings',
    schema: settingsSchema,
    right: 'admin',
    allowWhenDayClosed: true,
    apply(ctx, p: z.infer<typeof settingsSchema>) {
      const before = readSettings(ctx.db.prepare('SELECT key, value FROM tableqr_setting').all() as Array<{ key: string; value: string }>);
      const rows: Array<[string, string]> = [
        ['enabled', p.enabled ? '1' : '0'],
        ['acceptMode', p.acceptMode],
        ['payOnline', p.payOnline ? '1' : '0'],
        ['baseUrl', p.baseUrl.replace(/\/+$/, '')],
        ['codeAddress', p.codeAddress],
        ['welcome', p.welcome],
      ];
      for (const [k, v] of rows) ctx.db.prepare('INSERT INTO tableqr_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
      ctx.audit({ entity: 'tableqr', entityId: 'settings', action: 'tableqr.settings', before, after: p });
      // the outlet keeps its order hub connection while the codes point there (P5-03)
      if (before.codeAddress !== p.codeAddress || before.enabled !== p.enabled) ctx.emit('system', 'addon.hub', { addonId: 'tableqr' });
      return { result: { saved: true } };
    },
  });

  host.command({
    type: 'TableQrMakeCodes',
    schema: codesSchema,
    right: 'admin',
    allowWhenDayClosed: true,
    apply(ctx, p: z.infer<typeof codesSchema>) {
      const tables = (ctx.db.prepare('SELECT id FROM dining_table').all() as Array<{ id: string }>).map((t) => t.id);
      const wanted = p.tableIds ? tables.filter((t) => p.tableIds!.includes(t)) : tables;
      const have = new Set((ctx.db.prepare('SELECT table_id FROM tableqr_table').all() as Array<{ table_id: string }>).map((r) => r.table_id));
      let made = 0;
      for (const t of wanted) {
        if (have.has(t) && !p.renew) continue;
        const tok = randomBytes(18).toString('base64url');
        ctx.db.prepare('INSERT INTO tableqr_table (table_id, token, created_at) VALUES (?, ?, ?) ON CONFLICT(table_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at').run(t, tok, ctx.nowIso);
        made++;
      }
      // a renewed code stops the old printed one at once (it named that table)
      ctx.audit({ entity: 'tableqr', entityId: 'codes', action: p.renew ? 'tableqr.codes.renew' : 'tableqr.codes', after: { tables: wanted.length, made } });
      return { result: { made } };
    },
  });

  host.command({
    type: 'TableQrGuestRequest',
    schema: guestRequestSchema,
    right: null,
    internal: true,
    apply(ctx, p: z.infer<typeof guestRequestSchema>) {
      const pending = ctx.db.prepare("SELECT count(*) AS n FROM tableqr_request WHERE table_id = ? AND status = 'pending' AND created_at >= ?").get(p.tableId, since(ctx.nowIso)) as { n: number };
      if (pending.n >= MAX_PENDING_PER_TABLE) fail('INVALID_STATE', 'Your table already has requests waiting. A member of staff will be with you shortly.');
      ctx.db
        .prepare(
          `INSERT INTO tableqr_request (id, table_id, kind, status, guest_id, items_json, covers, note, amount_paise, bill_id, created_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ctx.commandId, p.tableId, p.kind, p.guestId, p.lines ? JSON.stringify(p.lines) : null, p.covers ?? null, p.note ?? null, p.amountPaise ?? null, p.billId ?? null, ctx.nowIso);
      ctx.audit({ entity: 'tableqr_request', entityId: ctx.commandId, action: `tableqr.${p.kind}`, after: { tableId: p.tableId, lines: p.lines?.length ?? 0, amountPaise: p.amountPaise ?? null } });
      ctx.emit('floor', 'tableqr.request', { requestId: ctx.commandId, tableId: p.tableId, kind: p.kind });
      return { result: { requestId: ctx.commandId } };
    },
  });

  host.command({
    type: 'TableQrResolve',
    schema: resolveSchema,
    right: null,
    internal: true,
    apply(ctx, p: z.infer<typeof resolveSchema>) {
      const r = ctx.db.prepare('SELECT id, table_id, kind, status FROM tableqr_request WHERE id = ?').get(p.requestId) as { id: string; table_id: string; kind: RequestKind; status: RequestStatus } | undefined;
      if (!r) fail('NOT_FOUND', 'This request is no longer there.');
      if (r!.status !== 'pending') fail('INVALID_STATE', `This request was already ${r!.status}.`, { status: r!.status });
      ctx.db.prepare('UPDATE tableqr_request SET status = ?, reason = ?, order_id = coalesce(?, order_id), handled_at = ?, handled_by = ? WHERE id = ?').run(p.status, p.reason ?? null, p.orderId ?? null, ctx.nowIso, ctx.actor.userId, p.requestId);
      ctx.audit({ entity: 'tableqr_request', entityId: p.requestId, action: `tableqr.${p.status}`, before: { status: 'pending' }, after: { status: p.status, orderId: p.orderId ?? null }, reason: p.reason ?? null });
      ctx.emit('floor', 'tableqr.request', { requestId: p.requestId, tableId: r!.table_id, kind: r!.kind, status: p.status });
      return { result: { status: p.status } };
    },
  });

  // ------------------------------------------------------------------ reads

  const settings = (): QrSettings => readSettings(host.db.all<{ key: string; value: string }>('SELECT key, value FROM tableqr_setting'));
  const tableByToken = (t: unknown) => {
    const tok = token.safeParse(t);
    if (!tok.success) fail('NOT_FOUND', 'This QR code is not valid. Please ask a member of staff.');
    const row = host.db.get<{ id: string; label: string }>('SELECT d.id, d.label FROM tableqr_table q JOIN dining_table d ON d.id = q.table_id WHERE q.token = ?', tok.data);
    if (!row) fail('NOT_FOUND', 'This QR code is no longer valid. Please ask a member of staff for the new one.');
    return row!;
  };
  const guestTable = (t: unknown) => {
    const s = settings();
    if (!s.enabled) fail('INVALID_STATE', 'Ordering from the table is not available right now. Please ask a member of staff.');
    return { table: tableByToken(t), s };
  };
  const openOrder = (tableId: string) =>
    host.db.get<{ id: string; state: string; version: number }>(`SELECT id, state, version FROM "order" WHERE table_id = ? AND state IN ('open', 'billed') ORDER BY opened_at DESC LIMIT 1`, tableId);
  const menuItems = () => {
    const m = host.menu();
    return { m, byId: new Map<string, MenuItem>(m.items.map((i) => [i.id, i])) };
  };
  const wifiUrl = () => {
    const n = host.network();
    return n.addresses[0] && n.port ? `http://${n.addresses[0]}:${n.port}` : '';
  };
  const hubLink = () => host.hub?.() ?? null;
  const baseUrl = (s: QrSettings) => codeBase(s, wifiUrl(), hubLink());
  // guests reach these pages through the order hub only while the codes point there
  host.hubAccess?.(() => {
    const s = settings();
    return s.enabled && s.codeAddress === 'hub';
  });
  const since = (iso: string) => new Date(Date.parse(iso) - LIVE_HOURS * 3_600_000).toISOString();

  host.floorBadges((db) => {
    const rows = db.all<{ table_id: string; kind: RequestKind; amount_paise: number | null }>("SELECT table_id, kind, amount_paise FROM tableqr_request WHERE status = 'pending' AND created_at >= ?", since(host.now().toISOString()));
    const byTable = new Map<string, Array<{ kind: RequestKind; amountPaise: number | null }>>();
    for (const r of rows) byTable.set(r.table_id, [...(byTable.get(r.table_id) ?? []), { kind: r.kind, amountPaise: r.amount_paise }]);
    return [...byTable.entries()].flatMap(([tableId, list]) => badgesFor(list).map((b) => ({ tableId, ...b })));
  });

  // ------------------------------------------------------------------ accepting an order (staff, or automatic)

  /**
   * Seats the table if nobody did, adds the guest's dishes and sends them to the kitchen, then marks the request
   * accepted: each step with a command id made from the request, so a retry after any failure never repeats food.
   */
  const accept = (requestId: string, actor: Actor) => {
    const r = host.db.get<{ id: string; table_id: string; status: string; items_json: string | null; covers: number | null; kind: string }>('SELECT id, table_id, status, items_json, covers, kind FROM tableqr_request WHERE id = ?', requestId);
    if (!r || r.kind !== 'order') fail('NOT_FOUND', 'This order request is no longer there.');
    if (r!.status !== 'pending') fail('INVALID_STATE', `This order was already ${r!.status}.`);
    const lines = JSON.parse(r!.items_json ?? '[]') as CheckedLine[];
    const step = (name: string) => stableId(hex(`tableqr:${requestId}:${name}`));
    let order = openOrder(r!.table_id);
    if (order?.state === 'billed') fail('INVALID_STATE', 'The bill for this table is already printed. Add the dishes on the terminal if the guests want more.');
    if (!order) {
      host.executeOnce(step('open'), 'OpenTable', { tableId: r!.table_id, covers: r!.covers ?? 1, orderId: step('order') }, { actor });
      order = openOrder(r!.table_id)!;
    }
    const items = lines.map((l, i) => ({ id: step(`item${i}`), itemId: l.itemId, variantId: l.variantId, qty: l.qty, addons: l.addons, note: l.note }));
    host.executeOnce(step('add'), 'AddItems', { items }, { actor, orderId: order.id });
    host.executeOnce(step('fire'), 'FireKOT', { itemIds: items.map((i) => i.id) }, { actor, orderId: order.id });
    host.executeOnce(step('done'), 'TableQrResolve', { requestId, status: 'accepted', orderId: order.id }, { actor });
    return { status: 'accepted', orderId: order.id };
  };

  // ------------------------------------------------------------------ staff routes (/v1/addons/tableqr/...)

  host.route(
    'GET',
    '/settings',
    () => {
      const s = settings();
      const base = baseUrl(s);
      const tables = host.db.all<{ id: string; label: string; area: string; token: string | null }>(
        `SELECT d.id, d.label, a.name AS area, q.token FROM dining_table d JOIN area a ON a.id = d.area_id LEFT JOIN tableqr_table q ON q.table_id = d.id ORDER BY a.sort, a.name, d.label`,
      );
      const cfg = host.config();
      return {
        settings: s,
        upiReady: !!cfg['bill.upiVpa'],
        outletName: text(cfg['outlet.name']),
        baseUrl: base,
        wifiUrl: wifiUrl(),
        hub: hubLink(),
        addresses: host.network().addresses,
        port: host.network().port,
        tables: tables.map((t) => ({ id: t.id, label: t.label, area: t.area, url: t.token && base ? guestUrl(base, t.token) : null })),
      };
    },
    { access: 'staff', right: 'admin' },
  );
  host.route('POST', '/settings', (req) => host.execute('TableQrSaveSettings', req.body, { actor: req.actor! }).result, { access: 'staff', right: 'admin' });
  host.route('POST', '/codes', (req) => host.execute('TableQrMakeCodes', req.body ?? {}, { actor: req.actor! }).result, { access: 'staff', right: 'admin' });

  host.route(
    'GET',
    '/requests',
    () => {
      const rows = host.db.all<{
        id: string;
        table_id: string;
        label: string;
        kind: RequestKind;
        status: RequestStatus;
        items_json: string | null;
        covers: number | null;
        note: string | null;
        amount_paise: number | null;
        bill_id: string | null;
        reason: string | null;
        created_at: string;
        handled_at: string | null;
        handled_by_name: string | null;
      }>(
        `SELECT r.*, d.label, u.name AS handled_by_name FROM tableqr_request r JOIN dining_table d ON d.id = r.table_id LEFT JOIN app_user u ON u.id = r.handled_by
         WHERE r.created_at >= ? ORDER BY r.status = 'pending' DESC, r.created_at DESC LIMIT 100`,
        since(host.now().toISOString()),
      );
      return {
        settings: settings(),
        requests: rows.map((r) => {
          const lines = r.items_json ? (JSON.parse(r.items_json) as CheckedLine[]) : [];
          return {
            id: r.id,
            tableId: r.table_id,
            table: r.label,
            kind: r.kind,
            status: r.status,
            lines: lines.map((l) => ({ label: l.label, qty: l.qty, note: l.note, amountPaise: l.amountPaise })),
            amountPaise: r.kind === 'order' ? lines.reduce((s, l) => s + l.amountPaise, 0) : r.amount_paise,
            covers: r.covers,
            note: r.note,
            billId: r.bill_id,
            reason: r.reason,
            createdAt: r.created_at,
            handledAt: r.handled_at,
            handledBy: r.handled_by_name,
          };
        }),
      };
    },
    { access: 'staff' },
  );
  host.route('POST', '/requests/:id/accept', (req) => accept(reqId(req.params.id), req.actor!), { access: 'staff', right: 'kot.fire' });
  host.route(
    'POST',
    '/requests/:id/reject',
    (req) => {
      const reason = z.object({ reason: z.string().trim().min(1).max(120) }).safeParse(req.body ?? {});
      if (!reason.success) fail('VALIDATION', 'Say why, for the guest (at most 120 characters).');
      return host.execute('TableQrResolve', { requestId: reqId(req.params.id), status: 'rejected', reason: reason.data!.reason }, { actor: req.actor! }).result;
    },
    { access: 'staff', right: 'order.edit' },
  );
  host.route('POST', '/requests/:id/done', (req) => host.execute('TableQrResolve', { requestId: reqId(req.params.id), status: 'done' }, { actor: req.actor! }).result, { access: 'staff' });
  /** The cashier checked the money arrived (bank app, soundbox): the bill is settled as UPI for its full amount. */
  host.route(
    'POST',
    '/requests/:id/confirm-pay',
    (req) => {
      const requestId = reqId(req.params.id);
      const r = host.db.get<{ kind: string; status: string; bill_id: string | null; amount_paise: number | null }>('SELECT kind, status, bill_id, amount_paise FROM tableqr_request WHERE id = ?', requestId);
      if (!r || r.kind !== 'pay') fail('NOT_FOUND', 'This payment is no longer there.');
      if (r!.status !== 'pending') fail('INVALID_STATE', `This payment was already ${r!.status}.`);
      const bill = host.db.get<{ id: string; order_id: string; total_paise: number; state: string }>('SELECT id, order_id, total_paise, state FROM bill WHERE id = ?', r!.bill_id);
      if (!bill || bill.state !== 'printed') fail('INVALID_STATE', 'This bill is no longer waiting for payment (it was changed, settled or voided).');
      const step = (name: string) => stableId(hex(`tableqr:${requestId}:${name}`));
      host.executeOnce(step('settle'), 'Settle', { billId: bill!.id, tenders: [{ mode: 'upi', amountPaise: bill!.total_paise, ref: 'Table QR' }] }, { actor: req.actor!, orderId: bill!.order_id });
      host.executeOnce(step('done'), 'TableQrResolve', { requestId, status: 'done' }, { actor: req.actor! });
      return { settled: true };
    },
    { access: 'staff', right: 'bill.settle' },
  );

  // ------------------------------------------------------------------ guest page and API (/a/tableqr/...)

  host.static('index.html', 'web/index.html');
  host.static('app.js', 'web/app.js');
  host.static('app.css', 'web/app.css');

  host.route(
    'GET',
    '/table',
    (req) => {
      const { table, s } = guestTable(req.query.t);
      const cfg = host.config();
      const order = openOrder(table.id);
      return { outlet: text(cfg['outlet.name']), table: table.label, welcome: s.welcome, acceptMode: s.acceptMode, seated: !!order, payOnline: s.payOnline && !!cfg['bill.upiVpa'] };
    },
    { access: 'guest' },
  );

  host.route(
    'GET',
    '/menu',
    (req) => {
      guestTable(req.query.t);
      const m = host.menu();
      const items = m.items.filter((i) => i.available);
      const used = new Set(items.flatMap((i) => i.addonGroupIds));
      const cats = new Set(items.map((i) => i.categoryId));
      return {
        menuVersion: m.menuVersion,
        categories: m.categories.filter((c) => cats.has(c.id)).map(({ id, name, sort }) => ({ id, name, sort })),
        addonGroups: m.addonGroups.filter((g) => used.has(g.id)),
        items: items.map(({ id, categoryId, name, veg, pricePaise, variants, addonGroupIds, image, sort }) => ({ id, categoryId, name, veg, pricePaise, variants, addonGroupIds, image: image ?? null, sort })),
      };
    },
    { access: 'guest' },
  );

  host.route(
    'GET',
    '/image/:name',
    (req) => {
      guestTable(req.query.t);
      const name = z.string().regex(/^[0-9a-f]{64}\.(webp|jpg|png)$/).safeParse(req.params.name);
      if (!name.success) fail('NOT_FOUND', 'No such photo.');
      const img = host.db.get<{ content_type: string; bytes: Uint8Array }>('SELECT content_type, bytes FROM menu_image WHERE name = ?', name.data);
      if (!img) fail('NOT_FOUND', 'No such photo.');
      return host.file(img!.content_type, img!.bytes);
    },
    { access: 'guest' },
  );

  host.route(
    'POST',
    '/order',
    (req) => {
      const body = z
        .object({ t: token, guestId, covers: z.number().int().min(1).max(99).nullable().optional(), lines: z.array(lineSchema).min(1).max(30), note: z.string().trim().max(200).nullable().optional() })
        .strict()
        .safeParse(req.body);
      if (!body.success) fail('VALIDATION', 'Your order could not be read. Please refresh the page and try again.');
      const { table, s } = guestTable(body.data!.t);
      const order = openOrder(table.id);
      if (order?.state === 'billed') fail('INVALID_STATE', 'Your bill is already printed. Please ask a member of staff to add more.');
      let lines: CheckedLine[];
      try {
        lines = checkOrder(menuItems().m, body.data!.lines);
      } catch (e) {
        return fail('VALIDATION', e instanceof Error ? e.message : 'Your order could not be placed.');
      }
      const covers = order ? null : (body.data!.covers ?? null);
      if (!order && !covers) fail('VALIDATION', 'How many guests are at the table?');
      const placed = host.execute('TableQrGuestRequest', { tableId: table.id, kind: 'order', guestId: body.data!.guestId, lines, covers, note: body.data!.note ?? null }, { actor: host.systemActor() }).result as { requestId: string };
      if (s.acceptMode === 'auto') {
        try {
          accept(placed.requestId, host.systemActor());
          return { requestId: placed.requestId, status: 'accepted' };
        } catch (e) {
          // automatic accepting could not finish (e.g. the table is held for a booking): staff will see it waiting
          host.log.warn('automatic accept failed; left for staff', { requestId: placed.requestId, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { requestId: placed.requestId, status: 'pending' };
    },
    { access: 'guest' },
  );

  host.route(
    'POST',
    '/call',
    (req) => {
      const body = z.object({ t: token, guestId }).strict().safeParse(req.body);
      if (!body.success) fail('VALIDATION', 'Please refresh the page and try again.');
      const { table } = guestTable(body.data!.t);
      const waiting = host.db.get<{ id: string }>("SELECT id FROM tableqr_request WHERE table_id = ? AND kind = 'waiter' AND status = 'pending' AND created_at >= ?", table.id, since(host.now().toISOString()));
      if (waiting) return { requestId: waiting.id, status: 'pending' };
      const r = host.execute('TableQrGuestRequest', { tableId: table.id, kind: 'waiter', guestId: body.data!.guestId }, { actor: host.systemActor() }).result as { requestId: string };
      return { requestId: r.requestId, status: 'pending' };
    },
    { access: 'guest' },
  );

  /** "Ask for the bill": the same request a captain makes (Bill asked on every terminal until it is printed). */
  host.route(
    'POST',
    '/bill',
    (req) => {
      const body = z.object({ t: token, guestId }).strict().safeParse(req.body);
      if (!body.success) fail('VALIDATION', 'Please refresh the page and try again.');
      const { table } = guestTable(body.data!.t);
      const order = openOrder(table.id);
      if (!order) fail('INVALID_STATE', 'There is nothing on your table’s bill yet.');
      if (order!.state === 'billed') return { status: 'printed' };
      host.execute('RequestBill', {}, { actor: host.systemActor(), orderId: order!.id });
      return { status: 'asked' };
    },
    { access: 'guest' },
  );

  /** The table's running bill, this guest's requests, and how to pay a printed bill. */
  host.route(
    'GET',
    '/status',
    (req) => {
      const { table, s } = guestTable(req.query.t);
      const g = guestId.safeParse(req.query.g);
      const mine = g.success
        ? host.db.all<{ id: string; kind: RequestKind; status: RequestStatus; reason: string | null; created_at: string; amount_paise: number | null; items_json: string | null }>(
            'SELECT id, kind, status, reason, created_at, amount_paise, items_json FROM tableqr_request WHERE guest_id = ? AND table_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20',
            g.data,
            table.id,
            since(host.now().toISOString()),
          )
        : [];
      const order = openOrder(table.id);
      const snap = order ? host.order(order.id) : null;
      const cfg = host.config();
      const printed = snap?.bills.filter((b) => b.state === 'printed') ?? [];
      const bill = printed.length === 1 ? printed[0]! : null;
      const pay =
        bill && s.payOnline && cfg['bill.upiVpa']
          ? {
              billId: bill.id,
              billNo: bill.billNoText ?? String(bill.billNo ?? ''),
              amountPaise: bill.totalPaise - bill.paidPaise,
              link: upiLink(text(cfg['bill.upiVpa']), text(cfg['bill.upiPayeeName']) || text(cfg['outlet.name']), bill.totalPaise - bill.paidPaise, `Bill ${bill.billNoText ?? bill.billNo ?? ''} table ${table.label}`),
              claimed: !!host.db.get("SELECT 1 FROM tableqr_request WHERE kind = 'pay' AND bill_id = ? AND status IN ('pending', 'done')", bill.id),
            }
          : null;
      return {
        table: table.label,
        requests: mine.map((r) => ({ id: r.id, kind: r.kind, status: r.status, reason: r.reason, at: r.created_at, lines: r.items_json ? (JSON.parse(r.items_json) as CheckedLine[]).map((l) => ({ label: l.label, qty: l.qty })) : [] })),
        bill: snap
          ? {
              lines: snap.items.filter((i) => i.status !== 'cancelled').map((i) => ({ name: i.name, qty: i.qty, amountPaise: (i.unitPricePaise + i.addons.reduce((s2, a) => s2 + a.pricePaise * a.qty, 0)) * i.qty, sent: i.status === 'fired' })),
              totals: snap.totals,
              printed: !!bill,
              billTotalPaise: bill?.totalPaise ?? null,
              asked: !!snap.billRequest,
            }
          : null,
        pay,
      };
    },
    { access: 'guest' },
  );

  /** "I have paid": the cashier sees it on the table and confirms once the money is in. */
  host.route(
    'POST',
    '/paid',
    (req) => {
      const body = z.object({ t: token, guestId, billId: id26 }).strict().safeParse(req.body);
      if (!body.success) fail('VALIDATION', 'Please refresh the page and try again.');
      const { table, s } = guestTable(body.data!.t);
      if (!s.payOnline) fail('INVALID_STATE', 'Please pay at the counter.');
      const bill = host.db.get<{ id: string; total_paise: number; state: string; table_id: string | null }>('SELECT b.id, b.total_paise, b.state, o.table_id FROM bill b JOIN "order" o ON o.id = b.order_id WHERE b.id = ?', body.data!.billId);
      if (!bill || bill.table_id !== table.id) fail('NOT_FOUND', 'This bill is not for your table.');
      if (bill!.state !== 'printed') fail('INVALID_STATE', 'This bill is already paid or was changed. Please ask a member of staff.');
      const claimed = host.db.get<{ id: string }>("SELECT id FROM tableqr_request WHERE kind = 'pay' AND bill_id = ? AND status = 'pending'", bill!.id);
      if (claimed) return { requestId: claimed.id, status: 'pending' };
      const r = host.execute('TableQrGuestRequest', { tableId: table.id, kind: 'pay', guestId: body.data!.guestId, amountPaise: bill!.total_paise, billId: bill!.id }, { actor: host.systemActor() }).result as { requestId: string };
      return { requestId: r.requestId, status: 'pending' };
    },
    { access: 'guest' },
  );
}
