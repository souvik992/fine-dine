import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type DinePosApp } from '../app.js';
import type { Db } from '../db/connection.js';
import { createTestDb } from '../testing/test-db.js';

// P3-01: the captain app is served at /captain to phones that are not paired yet (it is code, not data).
let dir: string;
let db: Db;
let app: DinePosApp;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dinepos-web-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Captain</title>');
  writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(path.join(dir, 'sw.js'), '// sw');
  writeFileSync(path.join(dir, 'manifest.webmanifest'), '{}');
  db = createTestDb();
  app = buildApp({ db, timeZone: 'Asia/Kolkata', trustLoopback: false, captainDir: dir });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('captain app files', () => {
  it('serve the page to an unpaired phone, with a strict content policy; the API still needs a paired device', async () => {
    const page = await app.inject({ method: 'GET', url: '/captain/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await app.inject({ method: 'GET', url: '/captain' })).headers.location).toBe('/captain/');
    expect((await app.inject({ method: 'GET', url: '/v1/floor' })).statusCode).toBe(401);
  });

  it('hashed assets are cached for a year; the service worker and manifest never go stale', async () => {
    const js = await app.inject({ method: 'GET', url: '/captain/assets/index-abc.js' });
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ method: 'GET', url: '/captain/sw.js' })).headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ method: 'GET', url: '/captain/manifest.webmanifest' })).headers['content-type']).toContain('application/manifest+json');
  });

  it('app routes get the page; missing files and paths outside the folder are 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/captain/tables/T7' })).body).toContain('<title>Captain</title>');
    expect((await app.inject({ method: 'GET', url: '/captain/assets/missing.js' })).statusCode).toBe(404);
    // Never served from outside the folder: refused as a missing file, or (once the URL is normalised to a path
    // outside /captain) by the device check.
    for (const url of ['/captain/..%2f..%2fpackage.json', '/captain/%2e%2e/%2e%2e/secret.txt', '/captain/..\\..\\x.db']) {
      expect([401, 404], url).toContain((await app.inject({ method: 'GET', url })).statusCode);
    }
  });

  it('says how to build it when the app is missing', async () => {
    const bare = buildApp({ db, timeZone: 'Asia/Kolkata', captainDir: path.join(dir, 'nope') });
    const res = await bare.inject({ method: 'GET', url: '/captain/' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('npm run build -w @dinepos/captain');
    await bare.close();
  });
});
