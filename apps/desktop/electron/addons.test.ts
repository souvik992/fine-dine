import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { canonicalManifest } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { addonFileProblem, parseAddonUrl } from './addons.js';

// P5-01: the terminal runs an add-on's screens only after checking the signature itself, with keys built into the app.
const keys = generateKeyPairSync('ed25519');
const trust = { k1: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const ui = Buffer.from('window.__DINEPOS__.register("tableqr", {})');
const manifest = (over: Record<string, unknown> = {}, signer = keys.privateKey) => {
  const m = { id: 'tableqr', name: 'Table QR', version: '1.0.0', minPosVersion: '0.1.0', commandPrefix: 'TableQr', keyId: 'k1', files: { 'backend.cjs': 'a'.repeat(64), 'ui/ui.js': createHash('sha256').update(ui).digest('hex') }, ...over };
  return JSON.stringify({ ...m, signature: sign(null, Buffer.from(canonicalManifest(m as never)), signer).toString('base64') });
};

describe('add-on screens on the terminal', () => {
  it('parses app://dinepos/addons/<id>/<file>?server=<http origin> only', () => {
    expect(parseAddonUrl('app://dinepos/addons/tableqr/ui.js?server=http%3A%2F%2F192.168.1.20%3A7420')).toEqual({ id: 'tableqr', file: 'ui.js', server: 'http://192.168.1.20:7420' });
    expect(parseAddonUrl('app://dinepos/addons/tableqr/ui.css?server=https://hub.example.com/x')).toEqual({ id: 'tableqr', file: 'ui.css', server: 'https://hub.example.com' });
    for (const url of ['app://dinepos/addons/tableqr/backend.cjs?server=http://a', 'app://dinepos/addons/Table/ui.js?server=http://a', 'app://dinepos/addons/tableqr/ui.js?server=file:///c:/x', 'app://dinepos/addons/tableqr/ui.js', 'app://dinepos/addons/../ui.js?server=http://a']) {
      expect(parseAddonUrl(url), url).toBeNull();
    }
  });

  it('accepts the signed file; refuses another key, a changed file, another add-on, a missing file', () => {
    expect(addonFileProblem(manifest(), 'tableqr', 'ui.js', ui, trust)).toBeNull();
    expect(addonFileProblem(manifest({}, generateKeyPairSync('ed25519').privateKey), 'tableqr', 'ui.js', ui, trust)).toMatch(/signature is not valid/);
    expect(addonFileProblem(manifest({ keyId: 'other' }), 'tableqr', 'ui.js', ui, trust)).toMatch(/does not trust/);
    expect(addonFileProblem(manifest(), 'tableqr', 'ui.js', Buffer.from('evil()'), trust)).toMatch(/does not match/);
    expect(addonFileProblem(manifest(), 'other', 'ui.js', ui, trust)).toMatch(/another add-on/);
    expect(addonFileProblem(manifest(), 'tableqr', 'ui.css', ui, trust)).toMatch(/no such screen file/);
    // a signed manifest edited afterwards (e.g. a new fingerprint for a changed file) no longer verifies
    const edited = JSON.parse(manifest()) as { files: Record<string, string> };
    edited.files['ui/ui.js'] = createHash('sha256').update('evil()').digest('hex');
    expect(addonFileProblem(JSON.stringify(edited), 'tableqr', 'ui.js', Buffer.from('evil()'), trust)).toMatch(/signature is not valid/);
  });
});
