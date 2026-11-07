import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP, isAppUrl, resolveAppFile } from './protocol.js';

const root = path.resolve('/opt/dinepos/dist-renderer');

describe('app:// scheme', () => {
  it('serves files inside the renderer folder with a known type', () => {
    expect(resolveAppFile('app://dinepos/index.html', root)).toEqual({ file: path.join(root, 'index.html'), type: 'text/html; charset=utf-8' });
    expect(resolveAppFile('app://dinepos/', root)?.file).toBe(path.join(root, 'index.html'));
    expect(resolveAppFile('app://dinepos/assets/app-1a2b.js?x=1', root)?.type).toBe('text/javascript; charset=utf-8');
  });

  it('refuses traversal, other hosts and unknown types', () => {
    // The URL parser already folds "..": these stay inside the renderer folder.
    expect(resolveAppFile('app://dinepos/%2e%2e/%2e%2e/secret.js', root)?.file).toBe(path.join(root, 'secret.js'));
    expect(resolveAppFile('app://dinepos/../../etc/passwd', root)).toBeNull(); // no known type
    // Encoded backslashes survive URL parsing and become separators on Windows: must not escape.
    expect(resolveAppFile('app://dinepos/..%5C..%5Csecret.js', root)).toBeNull();
    expect(resolveAppFile('app://dinepos/%00index.html', root)).toBeNull();
    expect(resolveAppFile('app://other/index.html', root)).toBeNull();
    expect(resolveAppFile('app://dinepos/run.exe', root)).toBeNull();
    expect(resolveAppFile('https://dinepos/index.html', root)).toBeNull();
  });

  it('recognises only its own origin', () => {
    expect(isAppUrl('app://dinepos/index.html')).toBe(true);
    expect(isAppUrl('app://dinepos.evil/index.html')).toBe(false);
    expect(isAppUrl('not a url')).toBe(false);
  });

  it('keeps the CSP strict: own scripts only, no plugins, no framing', () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe/);
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org;"); // map tiles are the only outside images
  });
});
