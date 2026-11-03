// Every order change on the phone goes through the outbox (P3-03, docs/05): stored on the phone first, sent at once
// when the outlet server can be reached, replayed in order when it comes back. Also keeps the last copy of the
// floor, menu and orders so the app still shows them offline.
import { ApiError, orderView, Outbox, seatLabel, type OrderView, type OutboxEntry, type OutboxStore } from '@dinepos/client';
import { newId, type FloorTable, type MenuSnapshot, type OrderSnapshot } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app-context.js';
import { firedMessage } from '../order-model.js';
import { openStores, type KeyValueCache } from './idb.js';

/** Try waiting changes again this often while some are queued (docs/05: health check every 10 s when down). */
export const REPLAY_EVERY_MS = 10_000;

export interface Change {
  type: OutboxEntry['type'];
  payload: Record<string, unknown>;
  label: string;
  qtyFrom?: number;
}

type Toast = { kind: 'ok' | 'error'; text: string } | null;

interface SyncCtx {
  ready: boolean;
  /** False when the phone refused IndexedDB: waiting changes are lost if the page is closed. */
  durable: boolean;
  online: boolean;
  entries: readonly OutboxEntry[];
  /** Seats a table (on the phone at once; on the server now or when it is back). Returns the new order id. */
  openTable: (table: FloorTable, covers: number) => string;
  /** Decides a change on the latest view of the order (server snapshot + what is still waiting) and queues it. */
  change: (orderId: string, menu: MenuSnapshot | undefined, decide: (view: OrderView) => Change | null) => void;
  retry: (seq: number) => void;
  discard: (seq: number) => void;
  reseat: (seq: number, table: FloorTable) => void;
  /** A GET that falls back to the last copy on this phone when the server cannot be reached. */
  cachedGet: <T>(path: string) => Promise<T>;
  /** The order's latest snapshot (never an older one); null while it exists only on this phone. */
  getOrder: (orderId: string) => Promise<OrderSnapshot | null>;
  notify: (kind: 'ok' | 'error', text: string) => void;
}

const SyncCtx = createContext<SyncCtx | null>(null);

const newer = (a: OrderSnapshot | null | undefined, b: OrderSnapshot) => (a && a.version > b.version ? a : b);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { api, session, stream, signOut } = useApp();
  const qc = useQueryClient();
  const [stores, setStores] = useState<{ outbox: OutboxStore; cache: KeyValueCache; durable: boolean } | null>(null);
  const [entries, setEntries] = useState<readonly OutboxEntry[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const online = stream === 'live';
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    void openStores().then(setStores);
  }, []);

  const notify = useCallback((kind: 'ok' | 'error', text: string) => setToast({ kind, text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'ok' ? 3_000 : 6_000);
    return () => clearTimeout(t);
  }, [toast]);

  const keepOrder = useCallback(
    (order: OrderSnapshot) => {
      const key = ['order', order.id];
      const latest = newer(qc.getQueryData<OrderSnapshot | null>(key), order);
      qc.setQueryData(key, latest);
      void stores?.cache.set(`order:${order.id}`, latest).catch(() => undefined);
    },
    [qc, stores],
  );

  const outbox = useMemo(() => {
    if (!stores) return null;
    return new Outbox(stores.outbox, api, {
      onSent: (e, res) => {
        if (res.order) keepOrder(res.order);
        if (e.type === 'OpenTable' || e.type === 'FireKOT' || e.type === 'SetCovers') void qc.invalidateQueries({ queryKey: ['floor'] });
        if (e.type === 'FireKOT') notify('ok', `${e.offline ? `Table ${e.table.label}: ` : ''}${firedMessage(res.result as { kots?: Array<{ kotNo: number }> })}`);
      },
      onSnapshot: keepOrder,
      onSkipped: (e, why) => notify('ok', `Table ${e.table.label}: ${why}`),
      onRejected: (e, err, dropped) => {
        notify('error', `${err.message}${dropped.length ? ` ${dropped.length} later change${dropped.length === 1 ? ' was' : 's were'} not sent.` : ''}`);
        if (err.code === 'UNAUTHENTICATED') signOutRef.current();
        void qc.invalidateQueries({ queryKey: ['order', e.orderId] });
      },
    });
  }, [stores, api, keepOrder, notify, qc]);

  useEffect(() => {
    if (!outbox) return;
    const off = outbox.subscribe((list) => setEntries([...list]));
    void outbox.init();
    return off;
  }, [outbox]);

  const kick = useCallback(() => {
    if (outbox && onlineRef.current) void outbox.replay();
  }, [outbox]);
  // Back online: send what waited. While anything is queued, keep trying (the stream may lag the network).
  useEffect(() => {
    if (online) kick();
  }, [online, kick]);
  const hasQueued = entries.some((e) => e.status === 'queued');
  useEffect(() => {
    if (!outbox || !hasQueued) return;
    const t = setInterval(() => void outbox.replay(), REPLAY_EVERY_MS);
    return () => clearInterval(t);
  }, [outbox, hasQueued]);

  const by = useCallback((): OutboxEntry['by'] => {
    const s = sessionRef.current;
    return { userId: s?.user.id ?? '', name: s?.user.name ?? '', token: s?.token ?? null };
  }, []);

  const queue = useCallback(
    (build: () => Omit<OutboxEntry, 'seq' | 'status' | 'problem' | 'offline' | 'commandId' | 'by' | 'queuedAt'> | null) => {
      if (!outbox) return;
      // One at a time, each decided on what the ones before it left (quick taps add up).
      chain.current = chain.current
        .then(async () => {
          const e = build();
          if (!e) return;
          await outbox.enqueue({ ...e, commandId: newId(), by: by(), queuedAt: new Date().toISOString(), offline: !onlineRef.current });
          kick();
        })
        .catch(() => notify('error', 'This phone could not save the change. Try again.'));
    },
    [outbox, by, kick, notify],
  );

  const value = useMemo<SyncCtx>(
    () => ({
      ready: outbox !== null,
      durable: stores?.durable ?? true,
      online,
      entries,
      openTable: (table, covers) => {
        const orderId = newId();
        queue(() => ({ type: 'OpenTable', orderId, table: { id: table.id, label: table.label, areaId: table.areaId }, label: seatLabel(table.label, covers), payload: { tableId: table.id, covers, orderId } }));
        return orderId;
      },
      change: (orderId, menu, decide) =>
        queue(() => {
          const view = outbox ? orderView(orderId, qc.getQueryData<OrderSnapshot | null>(['order', orderId]), outbox.list(), menu) : null;
          const c = view ? decide(view) : null;
          if (!view || !c || !view.table) return null;
          return { ...c, orderId, expectedVersion: view.version, table: { id: view.table.id, label: view.table.label, areaId: view.table.areaId || null } };
        }),
      retry: (seq) => {
        void outbox?.retry(seq, by()).then(kick);
      },
      discard: (seq) => {
        void outbox?.discard(seq).then((dropped) => {
          for (const id of new Set(dropped.map((d) => d.orderId))) void qc.invalidateQueries({ queryKey: ['order', id] });
          kick();
        });
      },
      reseat: (seq, table) => {
        void outbox?.reseat(seq, { id: table.id, label: table.label, areaId: table.areaId }).then(kick);
      },
      cachedGet: async <T,>(path: string) => {
        try {
          const data = await api.get<T>(path);
          void stores?.cache.set(path, data).catch(() => undefined);
          return data;
        } catch (err) {
          const copy = err instanceof ApiError && err.code === 'NETWORK' ? await stores?.cache.get<T>(path) : undefined;
          if (copy === undefined) throw err;
          return copy;
        }
      },
      getOrder: async (orderId) => {
        const prev = qc.getQueryData<OrderSnapshot | null>(['order', orderId]);
        try {
          const s = newer(prev, await api.get<OrderSnapshot>(`/v1/orders/${orderId}`));
          void stores?.cache.set(`order:${orderId}`, s).catch(() => undefined);
          return s;
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          // Seated on this phone and not on the server yet.
          if (err.code === 'NOT_FOUND' && outbox?.list().some((e) => e.orderId === orderId && e.type === 'OpenTable')) return null;
          if (err.code !== 'NETWORK') throw err;
          const copy = prev ?? (await stores?.cache.get<OrderSnapshot>(`order:${orderId}`)) ?? null;
          if (copy === null && !outbox?.list().some((e) => e.orderId === orderId)) throw err;
          return copy;
        }
      },
      notify,
    }),
    [outbox, stores, online, entries, queue, qc, by, kick, api, notify],
  );

  return (
    <SyncCtx.Provider value={value}>
      {children}
      {toast ? (
        <p role={toast.kind === 'error' ? 'alert' : 'status'} className={`fixed inset-x-3 top-3 z-50 rounded-lg p-3 font-semibold shadow-lg ${toast.kind === 'error' ? 'bg-danger text-white' : 'bg-foreground text-background'}`} onClick={() => setToast(null)}>
          {toast.text}
        </p>
      ) : null}
    </SyncCtx.Provider>
  );
}

export function useSync(): SyncCtx {
  const v = useContext(SyncCtx);
  if (!v) throw new Error('useSync outside SyncProvider');
  return v;
}
