import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalManifest as sharedCanonical } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { checkPackage } from '../../../apps/server/src/addons/package.js';
import { canonicalManifest as buildCanonical } from '../scripts/canonical.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.join(here, '..', '..', 'dist', 'packages', 'tableqr');

describe('Table QR package', () => {
  it('the build signs exactly the bytes DinePOS checks', () => {
    const m = { id: 'tableqr', name: 'Table QR', version: '1.0.0', minPosVersion: '0.1.0', commandPrefix: 'TableQr', keyId: 'k', rights: ['kot.fire'], files: { 'b.cjs': 'ab', 'a.js': 'cd' }, signature: 'x', description: undefined };
    expect(buildCanonical(m)).toBe(sharedCanonical(m as never));
  });

  it.runIf(existsSync(path.join(built, 'manifest.json')))('the built package passes the server’s check with the real trusted key', () => {
    const pkg = checkPackage(built, '0.1.0');
    expect(pkg.manifest).toMatchObject({ id: 'tableqr', commandPrefix: 'TableQr', rights: ['order.create', 'order.edit', 'kot.fire'] });
    expect([...pkg.files.keys()].sort()).toEqual(['backend.cjs', 'ui/ui.css', 'ui/ui.js', 'web/app.css', 'web/app.js', 'web/index.html']);
  });
});
