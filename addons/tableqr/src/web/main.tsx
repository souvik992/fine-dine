// Table QR guest page (P5-02 / P5-04): opened on a guest's phone from the code on the table. Menu, cart and order;
// call a waiter; ask for the bill; see the running bill; pay a printed bill by UPI and say so. Everything goes to the
// outlet server's /a/tableqr/api; prices are always the server's.
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRupees, type RequestKind, type RequestStatus } from '../logic.js';
import './app.css';

interface TableInfo {
  outlet: string;
  table: string;
  welcome: string;
  acceptMode: 'staff' | 'auto';
  seated: boolean;
  payOnline: boolean;
}
interface Variant {
  id: string;
  name: string;
  pricePaise: number;
}
interface Addon {
  id: string;
  name: string;
  pricePaise: number;
}
interface Group {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  addons: Addon[];
}
interface Item {
  id: string;
  categoryId: string;
  name: string;
  veg: boolean;
  pricePaise: number;
  variants: Variant[];
  addonGroupIds: string[];
  image: string | null;
  sort: number;
}
interface Menu {
  categories: Array<{ id: string; name: string; sort: number }>;
  addonGroups: Group[];
  items: Item[];
}
interface Status {
  requests: Array<{ id: string; kind: RequestKind; status: RequestStatus; reason: string | null; at: string; lines: Array<{ label: string; qty: number }> }>;
  bill: { lines: Array<{ name: string; qty: number; amountPaise: number; sent: boolean }>; totals: { subtotalPaise: number; taxPaise: number; totalPaise: number }; printed: boolean; billTotalPaise: number | null; asked: boolean } | null;
  pay: { billId: string; billNo: string; amountPaise: number; link: string; claimed: boolean } | null;
}
interface CartLine {
  key: string;
  item: Item;
  variant: Variant | null;
  addons: Addon[];
  qty: number;
  note: string;
}

const token = new URLSearchParams(location.search).get('t') ?? '';
const API = './api';

/** A random id for this phone, so it sees its own requests (not a login: anyone at the table may order). */
function guestId(): string {
  try {
    let g = localStorage.getItem('tableqr.guest');
    if (!g) {
      g = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      localStorage.setItem('tableqr.guest', g);
    }
    return g;
  } catch {
    return 'guest-without-storage';
  }
}
const GUEST = guestId();

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(data?.error?.message ?? 'Could not reach the restaurant’s system. Check that you are on its Wi-Fi.');
  return data as T;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const imageUrl = (name: string) => `${API}/image/${name}?t=${encodeURIComponent(token)}`;
const lineUnit = (l: CartLine) => (l.variant?.pricePaise ?? l.item.pricePaise) + l.addons.reduce((s, a) => s + a.pricePaise, 0);
const itemsText = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
const STATUS_TEXT: Record<RequestStatus, string> = { pending: 'Waiting for staff', accepted: 'Sent to the kitchen', rejected: 'Not accepted', done: 'Done' };

function Dot({ veg }: { veg: boolean }) {
  return <span className={`inline-block h-3 w-3 shrink-0 rounded-sm border-2 ${veg ? 'border-veg' : 'border-nonveg'} p-[1px]`} aria-label={veg ? 'Veg' : 'Non-veg'}><span className={`block h-full w-full rounded-full ${veg ? 'bg-veg' : 'bg-nonveg'}`} /></span>;
}

/** Choosing size, extras, quantity and a note for one dish. */
function ItemSheet({ item, groups, onAdd, onClose }: { item: Item; groups: Group[]; onAdd: (l: CartLine) => void; onClose: () => void }) {
  const [variant, setVariant] = useState<Variant | null>(item.variants[0] ?? null);
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const mine = groups.filter((g) => item.addonGroupIds.includes(g.id));
  const problem = mine.find((g) => {
    const n = g.addons.filter((a) => picked.includes(a.id)).length;
    return n < g.minSelect || (g.maxSelect > 0 && n > g.maxSelect);
  });
  const addons = mine.flatMap((g) => g.addons).filter((a) => picked.includes(a.id));
  const unit = (variant?.pricePaise ?? item.pricePaise) + addons.reduce((s, a) => s + a.pricePaise, 0);
  const toggle = (g: Group, a: Addon) => {
    const inGroup = g.addons.filter((x) => picked.includes(x.id)).map((x) => x.id);
    if (picked.includes(a.id)) setPicked(picked.filter((x) => x !== a.id));
    else if (g.maxSelect === 1) setPicked([...picked.filter((x) => !inGroup.includes(x)), a.id]);
    else if (g.maxSelect === 0 || inGroup.length < g.maxSelect) setPicked([...picked, a.id]);
  };
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-card p-5 pb-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={item.name}>
        {item.image ? <img src={imageUrl(item.image)} alt="" className="mb-3 aspect-[4/3] w-full rounded-2xl object-cover" /> : null}
        <div className="flex items-center gap-2">
          <Dot veg={item.veg} />
          <h2 className="text-xl font-bold">{item.name}</h2>
        </div>
        {item.variants.length ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold">Size</p>
            <div className="flex flex-wrap gap-2">
              {item.variants.map((v) => (
                <button key={v.id} className="chip" aria-pressed={variant?.id === v.id} onClick={() => setVariant(v)}>
                  {v.name} · {formatRupees(v.pricePaise)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {mine.map((g) => (
          <div key={g.id} className="mt-4">
            <p className="mb-2 text-sm font-semibold">
              {g.name} <span className="font-normal text-muted-foreground">{g.minSelect ? `choose ${g.minSelect === g.maxSelect ? g.minSelect : `at least ${g.minSelect}`}` : g.maxSelect ? `up to ${g.maxSelect}` : 'optional'}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {g.addons.map((a) => (
                <button key={a.id} className="chip" aria-pressed={picked.includes(a.id)} onClick={() => toggle(g, a)}>
                  {a.name}
                  {a.pricePaise ? ` +${formatRupees(a.pricePaise)}` : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-semibold">Note for the kitchen</span>
          <input className="h-11 w-full rounded-xl border border-border bg-card px-3" maxLength={100} placeholder="e.g. less spicy" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="mt-5 flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-border">
            <button className="h-11 w-11 text-xl" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less">−</button>
            <span className="w-8 text-center font-bold tabular-nums">{qty}</span>
            <button className="h-11 w-11 text-xl" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="More">+</button>
          </div>
          <button
            className="btn btn-primary flex-1"
            disabled={!!problem}
            onClick={() => onAdd({ key: `${item.id}:${variant?.id ?? ''}:${[...picked].sort().join(',')}:${note.trim()}`, item, variant, addons, qty, note: note.trim() })}
          >
            {problem ? `Choose ${problem.name.toLowerCase()}` : `Add · ${formatRupees(unit * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tab, setTab] = useState<'menu' | 'bill'>('menu');
  const [cat, setCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Item | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [covers, setCovers] = useState(2);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!token) {
      setFatal('This page needs the QR code on your table. Please scan it again.');
      return;
    }
    Promise.all([call<TableInfo>(`/table?t=${encodeURIComponent(token)}`), call<Menu>(`/menu?t=${encodeURIComponent(token)}`)])
      .then(([t, m]) => {
        setInfo(t);
        setMenu(m);
        document.title = `${t.outlet} · Table ${t.table}`;
      })
      .catch((e) => setFatal(msg(e)));
  }, []);
  const loadStatus = useCallback(() => {
    call<Status>(`/status?t=${encodeURIComponent(token)}&g=${GUEST}`)
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!info) return;
    loadStatus();
    const t = setInterval(loadStatus, 6000);
    return () => clearInterval(t);
  }, [info, loadStatus]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (menu?.items ?? []).filter((i) => (cat === 'all' || i.categoryId === cat) && (!q || i.name.toLowerCase().includes(q))).sort((a, b) => a.sort - b.sort);
  }, [menu, cat, search]);
  const cartTotal = cart.reduce((s, l) => s + lineUnit(l) * l.qty, 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  const add = (l: CartLine) => {
    setCart((c) => {
      const same = c.find((x) => x.key === l.key);
      return same ? c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(20, x.qty + l.qty) } : x)) : [...c, l];
    });
    setOpen(null);
    setToast({ text: `${l.item.name} added` });
  };
  const tap = (i: Item) => {
    if (i.variants.length || i.addonGroupIds.length) setOpen(i);
    else add({ key: `${i.id}:::`, item: i, variant: null, addons: [], qty: 1, note: '' });
  };
  const place = async () => {
    setBusy(true);
    try {
      const seated = info!.seated || !!status?.bill;
      const r = await call<{ status: string }>('/order', {
        t: token,
        guestId: GUEST,
        covers: seated ? null : covers,
        lines: cart.map((l) => ({ itemId: l.item.id, variantId: l.variant?.id ?? null, addonIds: l.addons.map((a) => a.id), qty: l.qty, note: l.note || null })),
      });
      setCart([]);
      setCartOpen(false);
      setInfo({ ...info!, seated: true });
      setToast({ text: r.status === 'accepted' ? 'Your order is on its way to the kitchen.' : 'Order sent. A member of staff will confirm it shortly.' });
      setTab('bill');
      loadStatus();
    } catch (e) {
      setToast({ text: msg(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const simple = async (path: string, done: string) => {
    setBusy(true);
    try {
      const r = await call<{ status?: string }>(path, { t: token, guestId: GUEST });
      setToast({ text: r.status === 'printed' ? 'Your bill is already printed: see below.' : done });
      loadStatus();
    } catch (e) {
      setToast({ text: msg(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const paid = async () => {
    if (!status?.pay) return;
    setBusy(true);
    try {
      await call('/paid', { t: token, guestId: GUEST, billId: status.pay.billId });
      setToast({ text: 'Thank you! The cashier will confirm your payment.' });
      loadStatus();
    } catch (e) {
      setToast({ text: msg(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  if (fatal) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8 text-center">
        <p className="text-4xl">🍽️</p>
        <p className="mt-4 text-lg font-semibold">{fatal}</p>
      </main>
    );
  }
  if (!info || !menu) return <main className="flex min-h-screen items-center justify-center text-muted-foreground">Loading the menu…</main>;

  return (
    <div className="mx-auto min-h-screen max-w-xl pb-28">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <h1 className="truncate text-lg font-bold">{info.outlet}</h1>
          <span className="ml-auto shrink-0 rounded-full bg-foreground px-3 py-0.5 text-sm font-bold text-background">Table {info.table}</span>
        </div>
        {info.welcome ? <p className="text-sm text-muted-foreground">{info.welcome}</p> : null}
        <div className="mt-2 flex gap-2">
          <button className="chip flex-1" aria-pressed={tab === 'menu'} onClick={() => setTab('menu')}>Menu</button>
          <button className="chip flex-1" aria-pressed={tab === 'bill'} onClick={() => setTab('bill')}>
            My table{status?.requests.some((r) => r.status === 'pending') ? ' ·' : ''}
          </button>
        </div>
        {tab === 'menu' ? (
          <>
            <input className="mt-2 h-10 w-full rounded-xl border border-border bg-card px-3 text-sm" placeholder="Search dishes" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
              <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
              {[...menu.categories].sort((a, b) => a.sort - b.sort).map((c) => (
                <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>
              ))}
            </div>
          </>
        ) : null}
      </header>

      {tab === 'menu' ? (
        <ul className="divide-y divide-border px-4">
          {items.map((i) => (
            <li key={i.id} className="flex gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Dot veg={i.veg} />
                  <p className="font-semibold">{i.name}</p>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{i.variants.length ? `from ${formatRupees(Math.min(...i.variants.map((v) => v.pricePaise)))}` : formatRupees(i.pricePaise)}</p>
              </div>
              <div className="relative w-24 shrink-0">
                {i.image ? <img src={imageUrl(i.image)} alt="" loading="lazy" className="h-20 w-24 rounded-xl object-cover" /> : <div className="h-12" />}
                <button className="btn btn-primary absolute -bottom-2 left-1/2 h-9 -translate-x-1/2 px-5 shadow" onClick={() => tap(i)} aria-label={`Add ${i.name}`}>
                  Add
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 ? <li className="py-16 text-center text-muted-foreground">No dishes found.</li> : null}
        </ul>
      ) : (
        <section className="space-y-4 px-4 pt-4">
          <div className="grid grid-cols-2 gap-2">
            <button className="btn" disabled={busy} onClick={() => void simple('/call', 'A waiter is on the way.')}>🙋 Call waiter</button>
            <button className="btn" disabled={busy || !status?.bill} onClick={() => void simple('/bill', 'We are bringing your bill.')}>🧾 Ask for bill</button>
          </div>
          {status?.requests.length ? (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mb-2 font-semibold">Your requests</p>
              <ul className="space-y-2 text-sm">
                {status.requests.map((r) => (
                  <li key={r.id}>
                    <span className="font-semibold">{r.kind === 'order' ? `Order (${itemsText(r.lines.reduce((s, l) => s + l.qty, 0))})` : r.kind === 'waiter' ? 'Waiter' : 'Payment'}</span>{' '}
                    <span className={r.status === 'rejected' ? 'text-danger' : r.status === 'pending' ? 'text-warn' : 'text-ok'}>{r.kind === 'pay' && r.status === 'done' ? 'Payment confirmed' : STATUS_TEXT[r.status]}</span>
                    {r.reason ? <span className="block text-muted-foreground">{r.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-2 font-semibold">Your table’s bill</p>
            {status?.bill?.lines.length ? (
              <>
                <ul className="space-y-1 text-sm">
                  {status.bill.lines.map((l, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular-nums">{l.qty} ×</span>
                      <span className="flex-1">{l.name}{l.sent ? '' : ' (not sent yet)'}</span>
                      <span className="tabular-nums">{formatRupees(l.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-border pt-2 text-sm">
                  <p className="flex justify-between"><span>Taxes</span><span className="tabular-nums">{formatRupees(status.bill.totals.taxPaise)}</span></p>
                  <p className="flex justify-between text-base font-bold"><span>{status.bill.printed ? 'Bill total' : 'So far'}</span><span className="tabular-nums">{formatRupees(status.bill.billTotalPaise ?? status.bill.totals.totalPaise)}</span></p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing yet. Order from the menu.</p>
            )}
          </div>
          {status?.pay ? (
            <div className="rounded-2xl border-2 border-primary bg-card p-4">
              <p className="font-semibold">Pay {formatRupees(status.pay.amountPaise)} by UPI</p>
              <p className="text-sm text-muted-foreground">Bill {status.pay.billNo}. Your UPI app opens with the amount filled in.</p>
              {status.pay.claimed ? (
                <p className="mt-3 font-semibold text-ok">Thank you! The cashier is confirming your payment.</p>
              ) : (
                <div className="mt-3 grid gap-2">
                  <a className="btn btn-primary" href={status.pay.link}>Pay with a UPI app</a>
                  <button className="btn" disabled={busy} onClick={() => void paid()}>I have paid</button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      {cartCount && tab === 'menu' ? (
        <button className="btn btn-primary fixed inset-x-4 bottom-4 z-20 mx-auto h-14 max-w-xl text-base shadow-xl" onClick={() => setCartOpen(true)}>
          {cartCount} item{cartCount > 1 ? 's' : ''} · {formatRupees(cartTotal)} · View order
        </button>
      ) : null}

      {cartOpen ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setCartOpen(false)}>
          <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-card p-5 pb-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Your order">
            <h2 className="text-xl font-bold">Your order</h2>
            <ul className="mt-3 divide-y divide-border">
              {cart.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{l.item.name}{l.variant ? ` (${l.variant.name})` : ''}</p>
                    {l.addons.length ? <p className="text-xs text-muted-foreground">+ {l.addons.map((a) => a.name).join(', ')}</p> : null}
                    {l.note ? <p className="text-xs text-warn">{l.note}</p> : null}
                  </div>
                  <div className="flex items-center rounded-xl border border-border">
                    <button className="h-9 w-9" onClick={() => setCart((c) => c.flatMap((x) => (x.key === l.key ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))} aria-label="Less">−</button>
                    <span className="w-6 text-center tabular-nums">{l.qty}</span>
                    <button className="h-9 w-9" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(20, x.qty + 1) } : x)))} aria-label="More">+</button>
                  </div>
                  <span className="w-20 text-right tabular-nums">{formatRupees(lineUnit(l) * l.qty)}</span>
                </li>
              ))}
            </ul>
            {!info.seated && !status?.bill ? (
              <label className="mt-4 flex items-center justify-between">
                <span className="font-semibold">Guests at the table</span>
                <span className="flex items-center rounded-xl border border-border">
                  <button className="h-10 w-10" onClick={() => setCovers(Math.max(1, covers - 1))} aria-label="Fewer guests">−</button>
                  <span className="w-8 text-center font-bold tabular-nums">{covers}</span>
                  <button className="h-10 w-10" onClick={() => setCovers(Math.min(30, covers + 1))} aria-label="More guests">+</button>
                </span>
              </label>
            ) : null}
            <p className="mt-4 flex justify-between text-lg font-bold"><span>Total before tax</span><span className="tabular-nums">{formatRupees(cartTotal)}</span></p>
            <p className="text-xs text-muted-foreground">{info.acceptMode === 'staff' ? 'A member of staff confirms your order before it goes to the kitchen.' : 'Your order goes straight to the kitchen.'}</p>
            <button className="btn btn-primary mt-4 h-14 w-full text-base" disabled={busy || !cart.length} onClick={() => void place()}>
              {busy ? 'Sending…' : 'Place order'}
            </button>
          </div>
        </div>
      ) : null}

      {open ? <ItemSheet item={open} groups={menu.addonGroups} onAdd={add} onClose={() => setOpen(null)} /> : null}

      {toast ? (
        <div role={toast.error ? 'alert' : 'status'} className={`fixed inset-x-4 top-4 z-40 mx-auto max-w-md rounded-2xl px-4 py-3 text-center font-semibold shadow-xl ${toast.error ? 'bg-danger text-white' : 'bg-foreground text-background'}`}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
