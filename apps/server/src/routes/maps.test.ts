import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Db } from '../db/connection.js';
import { createTestDb } from '../testing/test-db.js';
import { parseNominatim, tileOf } from './maps.js';

// Maps (as quickPOS ODS): the server fetches the map pictures and saves them, so the maps work without internet.
let db: Db;
let dir: string;
let app: ReturnType<typeof buildApp>;
let online = true;
let calls: Array<{ url: string; ua: string | null }> = [];
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');

beforeEach(() => {
  online = true;
  calls = [];
  db = createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), 'dinepos-tiles-'));
  const fakeFetch = ((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), ua: new Headers(init?.headers).get('user-agent') });
    if (!online) return Promise.reject(new Error('offline'));
    if (String(url).startsWith('https://nominatim.')) return Promise.resolve(Response.json([{ display_name: 'Park Street, Kolkata, West Bengal, India', lat: '22.5535', lon: '88.3517' }, { display_name: 'Abroad', lat: '51.5', lon: '0.1' }]));
    return Promise.resolve(new Response(PNG, { headers: { 'content-type': 'image/png' } }));
  }) as typeof fetch;
  app = buildApp({ db, timeZone: 'Asia/Kolkata', trustLoopback: true, maps: { dir, fetch: fakeFetch } });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('map routes', () => {
  it('a tile is fetched once with DinePOS’s own User-Agent, saved, and served from disk without internet', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/maps/tiles/15/23456/14000.png' });
    expect([first.statusCode, first.headers['content-type']]).toEqual([200, 'image/png']);
    expect(first.rawPayload.equals(PNG)).toBe(true);
    expect(calls).toEqual([{ url: 'https://tile.openstreetmap.org/15/23456/14000.png', ua: expect.stringContaining('DinePOS') as string }]);
    online = false;
    const again = await app.inject({ method: 'GET', url: '/v1/maps/tiles/15/23456/14000.png' });
    expect(again.statusCode).toBe(200);
    expect(again.rawPayload.equals(PNG)).toBe(true);
    expect(calls).toHaveLength(1); // fresh on disk: not asked again
    expect((await app.inject({ method: 'GET', url: '/v1/maps/tiles/15/1/2.png' })).json()).toMatchObject({ error: { code: 'INVALID_STATE' } }); // never saved, offline
  });

  it('refuses anything that is not a real tile', async () => {
    expect(tileOf('15', '23456', '14000.png')).toEqual({ z: 15, x: 23456, y: 14000 });
    for (const [z, x, y] of [['0', '0', '0'], ['20', '1', '1'], ['3', '8', '0'], ['3', '..', '1'], ['3', '1', '-1']] as const) expect(tileOf(z, x, y), `${z}/${x}/${y}`).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/v1/maps/tiles/3/9/0' })).statusCode).toBe(400);
  });

  it('the wider search returns places in India only, near the store', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/maps/places?q=park%20street&near=22.57,88.36' });
    expect(r.json()).toEqual({ places: [{ name: 'Park Street, Kolkata, West Bengal', lat: 22.5535, lng: 88.3517 }] });
    expect(calls[0]!.url).toContain('viewbox=');
    expect(parseNominatim({ not: 'a list' })).toEqual([]);
  });
});
