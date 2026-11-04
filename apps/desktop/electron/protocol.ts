// Pure helpers for the app:// scheme (kept free of Electron imports so they can be unit-tested).
import path from 'node:path';

export const SCHEME = 'app';
export const HOST = 'dinepos';
export const ORIGIN = `${SCHEME}://${HOST}`;
export const START_URL = `${ORIGIN}/index.html`;

/**
 * The renderer runs only our own bundled code. It may talk to any outlet server the user configures (LAN IP),
 * so connect-src allows http/ws; everything else is same-origin only.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", // blob: dish photos, fetched from the outlet server with this terminal's token
  "font-src 'self'",
  'connect-src http: https: ws: wss:',
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
}

/**
 * Maps an app:// URL to a file inside `root`, or null for anything outside it (path traversal, other hosts,
 * unknown file types). `/` serves index.html.
 */
export function resolveAppFile(url: string, root: string): { file: string; type: string } | null {
  if (!isAppUrl(url)) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // NUL and backslashes never appear in our asset names; a backslash is a separator on Windows.
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const file = path.resolve(root, `.${pathname}`);
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const type = TYPES[path.extname(file).toLowerCase()];
  return type ? { file, type } : null;
}
