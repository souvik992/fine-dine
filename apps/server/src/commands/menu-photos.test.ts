import { createHash } from 'node:crypto';
import { getMenu } from '../queries/menu.js';
import { getAdminCatalog } from '../queries/admin-catalog.js';
import { buildApp } from '../app.js';
import { newId, type MenuSnapshot } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { S, seedOutlet } from '../testing/order-fixture.js';

// Dish photos: stored once by content, one per dish, in the menu and the admin catalog, served by GET /v1/menu/images.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(18, 1)]).toString('base64');
const nameOf = (b64: string, ext: string) => `${createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')}.${ext}`;

describe('SetItemImage / RemoveItemImage', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));
  const photoOf = (id: string) => (getMenu(h.db) as MenuSnapshot).items.find((i) => i.id === id)?.image;

  it('sets a photo: stored once by its content, shown in the menu and the admin catalog; the menu version moves on', () => {
    const before = (getMenu(h.db) as MenuSnapshot).menuVersion;
    const res = h.run('SetItemImage', { itemId: S.paneerTikka, dataBase64: PNG });
    expect(res.result).toEqual({ itemId: S.paneerTikka, image: nameOf(PNG, 'png') });
    expect(photoOf(S.paneerTikka)).toBe(nameOf(PNG, 'png'));
    expect(getAdminCatalog(h.db).items.find((i) => i.id === S.paneerTikka)!.image).toBe(nameOf(PNG, 'png'));
    expect((getMenu(h.db) as MenuSnapshot).menuVersion).toBe(before + 1);
    expect(photoOf(S.dalMakhani)).toBeUndefined();
    h.run('SetItemImage', { itemId: S.dalMakhani, dataBase64: PNG }); // the same photo on another dish: stored once
    expect(h.count('menu_image')).toBe(1);
    expect(h.count('audit_event', "action = 'item.photo'")).toBe(2);
  });

  it('replacing a photo drops the old one when no dish shows it; removing it too', () => {
    h.run('SetItemImage', { itemId: S.paneerTikka, dataBase64: PNG });
    h.run('SetItemImage', { itemId: S.paneerTikka, dataBase64: WEBP });
    expect(photoOf(S.paneerTikka)).toBe(nameOf(WEBP, 'webp'));
    expect(h.db.prepare('SELECT name FROM menu_image').pluck().all()).toEqual([nameOf(WEBP, 'webp')]);
    h.run('RemoveItemImage', { itemId: S.paneerTikka });
    expect(photoOf(S.paneerTikka)).toBeUndefined();
    expect(h.count('menu_image')).toBe(0);
    expect(h.run('RemoveItemImage', { itemId: S.paneerTikka }).result).toEqual({ itemId: S.paneerTikka, image: null }); // nothing to remove
  });

  it('refuses what is not a JPG, PNG or WebP photo, and a dish that does not exist', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect(h.fail('SetItemImage', { itemId: S.paneerTikka, dataBase64: svg }, 'VALIDATION').message).toMatch(/JPG, PNG or WebP/);
    h.fail('SetItemImage', { itemId: newId(), dataBase64: PNG }, 'NOT_FOUND');
    h.fail('SetItemImage', { itemId: S.paneerTikka, dataBase64: 'not base64!' }, 'VALIDATION');
    expect(h.count('menu_image')).toBe(0);
  });

  it('needs the admin right; a replay sets it once', () => {
    expect(h.fail('SetItemImage', { itemId: S.paneerTikka, dataBase64: PNG }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'admin' });
    h.fail('RemoveItemImage', { itemId: S.paneerTikka }, 'FORBIDDEN', { rights: denyAll });
    const commandId = newId();
    const first = h.run('SetItemImage', { itemId: S.paneerTikka, dataBase64: PNG }, { commandId });
    expect(h.run('SetItemImage', { itemId: S.paneerTikka, dataBase64: PNG }, { commandId })).toEqual({ ...first, duplicate: true });
    expect(h.count('audit_event', "action = 'item.photo'")).toBe(1);
  });

  it('GET /v1/menu/images/<name> serves the photo, cached for good; unknown names are 404', async () => {
    h.run('SetItemImage', { itemId: S.paneerTikka, dataBase64: PNG });
    const app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata', now: TEST_NOW });
    const res = await app.inject({ method: 'GET', url: `/v1/menu/images/${nameOf(PNG, 'png')}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/v1/menu/images/${'0'.repeat(64)}.png` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/menu/images/..%2F..%2Fsecret' })).statusCode).toBe(404);
    await app.close();
  });
});
