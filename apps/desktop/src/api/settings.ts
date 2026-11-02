// Terminal settings kept in the renderer's own storage (app://dinepos origin, persisted by Electron).
const KEY = 'dinepos.serverUrl';
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7420';

/** Normalises what the user typed: adds http:// and the default port, drops a trailing slash. */
export function normaliseServerUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Enter the outlet server address, for example 192.168.1.10.');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That is not a valid address. Use an IP such as 192.168.1.10 or a name such as master-pc.');
  }
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('Enter only the address and port, without a path.');
  if (!u.port && u.protocol === 'http:') u.port = '7420';
  return `${u.protocol}//${u.host}`;
}

export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A `?server=` start parameter (installer, tests) wins for this session; otherwise the saved value. */
export function loadServerUrl(store: SettingsStore | undefined, search: string): string {
  const fromQuery = new URLSearchParams(search).get('server');
  if (fromQuery) {
    try {
      return normaliseServerUrl(fromQuery);
    } catch {
      // fall through to the saved value
    }
  }
  return store?.getItem(KEY) ?? DEFAULT_SERVER_URL;
}

export function saveServerUrl(store: SettingsStore, url: string): string {
  const clean = normaliseServerUrl(url);
  store.setItem(KEY, clean);
  return clean;
}
