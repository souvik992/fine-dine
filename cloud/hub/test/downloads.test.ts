import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, startHub } from './helpers.ts';
import type { TestHub } from './helpers.ts';

// P8-04: the portal's Windows downloads, from the newest GitHub Release of each product.
const asset = (name: string, size = 1000) => ({ name, size, browser_download_url: `https://github.com/dl/${name}`, state: 'uploaded' });
const release = (tag: string, at: string, names: string[], o: { draft?: boolean } = {}) => ({ tag_name: tag, draft: o.draft ?? false, prerelease: false, published_at: at, assets: names.map((n) => asset(n)) });

function fakeGitHub() {
  const state = {
    calls: 0,
    down: false,
    releases: {
      'souvik992/fine-dine': [
        // newest build: no Table QR (its signing secret was not set) -> Table QR comes from the build before
        release('dinepos-build-12', '2026-11-08T10:00:00Z', ['DinePOS-Setup-0.1.7.exe']),
        release('dinepos-build-11', '2026-11-07T10:00:00Z', ['DinePOS-Setup-0.1.6.exe', 'DinePOS-TableQR-Setup-1.2.0.exe']),
        release('dinepos-build-13', '2026-11-09T10:00:00Z', ['DinePOS-Setup-9.9.9.exe'], { draft: true }),
        release('something-else', '2026-11-10T10:00:00Z', ['DinePOS-Setup-0.0.1.exe']),
      ],
      'souvik992/tiffin': [release('tiffin-build-40', '2026-11-08T09:00:00Z', ['TiffinPOS-Setup-0.3.12.exe', 'TiffinPOS-ODS-Setup-1.0.13.exe', 'TiffinDataManager-Setup-0.1.0.exe'])],
    } as Record<string, unknown[]>,
  };
  const f = (async (url: string | URL) => {
    state.calls++;
    if (state.down) throw new Error('offline');
    const repo = /repos\/([^/]+\/[^/]+)\/releases/.exec(String(url))![1]!;
    return new Response(JSON.stringify(state.releases[repo] ?? []), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, f };
}

async function signedIn(h: TestHub) {
  const email = 'asha@spicegarden.in';
  await h.call('POST', '/v1/account/signup', { body: { businessName: 'Spice Garden', name: 'Asha Rao', email, phone: '9876543210', password: 'tandoor-2026' } });
  const code = /\b(\d{6})\b/.exec(h.mail.at(-1)!.text)![1];
  const res = await fetch(`${h.base}/v1/account/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
  return String(res.headers.get('set-cookie')).split(';')[0]!;
}

test('downloads: the newest build of each app and add-on, per product; an add-on missing from the newest build comes from the one before', async () => {
  const gh = fakeGitHub();
  const h = await startHub(undefined, undefined, undefined, { githubFetch: gh.f });
  try {
    const r = await h.call('GET', '/v1/downloads');
    assert.equal(r.status, 200);
    const by = Object.fromEntries((r.json.downloads as Array<{ id: string }>).map((d) => [d.id, d])) as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(by), ['dinepos', 'dinepos-tableqr', 'tiffin', 'tiffin-ods']);
    assert.deepEqual([by.dinepos!.version, by.dinepos!.build, by.dinepos!.product, by.dinepos!.app], ['0.1.7', '12', 'fine_dine', 'DinePOS']);
    assert.deepEqual([by['dinepos-tableqr']!.version, by['dinepos-tableqr']!.build, by['dinepos-tableqr']!.kind], ['1.2.0', '11', 'addon']);
    assert.deepEqual([by.tiffin!.version, by.tiffin!.productName, by['tiffin-ods']!.version], ['0.3.12', 'QSR', '1.0.13']);
    assert.equal('url' in by.dinepos!, false, 'the list does not hand out GitHub addresses; downloads go through the account');
    // cached: a second look does not ask GitHub again
    const calls = gh.state.calls;
    await h.call('GET', '/v1/downloads');
    assert.equal(gh.state.calls, calls);
  } finally { await h.close(); cleanup(h.dir); }
});

test('downloads: GitHub down keeps the last list (also after a restart); nothing published yet shows as not available', async () => {
  const gh = fakeGitHub();
  const h = await startHub(undefined, undefined, undefined, { githubFetch: gh.f });
  try {
    await h.call('GET', '/v1/downloads');
    gh.state.down = true;
    h.clock.t += 11 * 60_000; // past the cache time
    const later = await h.call('GET', '/v1/downloads');
    assert.equal(later.json.downloads[0].version, '0.1.7');
    const h2 = await startHub(h.dir, h.clock, undefined, { githubFetch: gh.f });
    try {
      const afterRestart = await h2.call('GET', '/v1/downloads');
      assert.equal(afterRestart.json.downloads[0].version, '0.1.7', 'the saved list is used while GitHub is down');
    } finally { await h2.close(); }
  } finally { await h.close(); cleanup(h.dir); }

  const empty = fakeGitHub();
  empty.state.releases = {};
  const e = await startHub(undefined, undefined, undefined, { githubFetch: empty.f });
  try {
    const r = await e.call('GET', '/v1/downloads');
    assert.deepEqual((r.json.downloads as Array<{ available: boolean; version: unknown }>).map((d) => [d.available, d.version]), [[false, null], [false, null], [false, null], [false, null]]);
  } finally { await e.close(); cleanup(e.dir); }
});

test('downloads: a signed-in account gets the installer (recorded); without signing in, or an unknown file, it does not', async () => {
  const gh = fakeGitHub();
  const h = await startHub(undefined, undefined, undefined, { githubFetch: gh.f });
  try {
    const anon = await fetch(`${h.base}/v1/account/downloads/dinepos`, { redirect: 'manual' });
    assert.equal(anon.status, 401);
    const cookie = await signedIn(h);
    const ok = await fetch(`${h.base}/v1/account/downloads/dinepos`, { redirect: 'manual', headers: { cookie } });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), 'https://github.com/dl/DinePOS-Setup-0.1.7.exe');
    await fetch(`${h.base}/v1/account/downloads/tiffin-ods`, { redirect: 'manual', headers: { cookie } });
    const unknown = await fetch(`${h.base}/v1/account/downloads/pizza`, { redirect: 'manual', headers: { cookie } });
    assert.equal(unknown.status, 404);
    const stats = await h.call('GET', '/v1/admin/downloads', { admin: true });
    assert.deepEqual((stats.json.stats as Array<{ item: string; version: string; downloads: number }>).map((s) => [s.item, s.version, s.downloads]).sort(), [['dinepos', '0.1.7', 1], ['tiffin-ods', '1.0.13', 1]]);
    assert.equal((await h.call('GET', '/v1/admin/downloads')).status, 403);
  } finally { await h.close(); cleanup(h.dir); }
});
