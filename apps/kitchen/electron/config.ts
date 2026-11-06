// DinePOS Kitchen: where the outlet server is, and what this kitchen PC may open. Pure (tested).

export interface KitchenConfig {
  /** The outlet server, e.g. "http://192.168.1.4:7420" (no path). */
  serverUrl: string | null;
  /** Open by itself when Windows starts (on by default: a kitchen PC is switched on, not operated). */
  autoStart: boolean;
  /** P2-15: which outlet server that is (GET /v1/health), so the app can follow it to a new IP address. */
  serverId: string | null;
  /**
   * P2-15: a copy of what the display keeps in the browser storage of the server's address: the screen's pairing
   * (device token) and its station. Browser storage belongs to one address, so after the server moves the app puts
   * these into the new address's storage, and the screen stays paired. Only ever given back to the same serverId.
   */
  deviceToken: string | null;
  station: string | null;
}

export const DEFAULT_CONFIG: KitchenConfig = { serverUrl: null, autoStart: true, serverId: null, deviceToken: null, station: null };

/** The display's own storage keys (apps/kds: storagePrefix "dinepos.kds", station key). */
export const KDS_DEVICE_KEY = 'dinepos.kds.device';
export const KDS_STATION_KEY = 'dinepos.kds.station';

const token = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max && /^[!-~]+$/.test(v) ? v : null);

/** Run in the display page: what it keeps now. */
export const CAPTURE_SCRIPT = `JSON.stringify([localStorage.getItem(${JSON.stringify(KDS_DEVICE_KEY)}), localStorage.getItem(${JSON.stringify(KDS_STATION_KEY)})])`;

/** What CAPTURE_SCRIPT returned, checked (the page is the server's, but it is still input). */
export function parseCaptured(raw: unknown): { deviceToken: string | null; station: string | null } | null {
  if (typeof raw !== 'string' || raw.length > 1024) return null;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j) || j.length !== 2) return null;
    return { deviceToken: token(j[0], 512), station: token(j[1], 64) };
  } catch {
    return null;
  }
}

/**
 * Run on a page of the server's address, before the display starts: the saved pairing and station, only where that
 * address has none (what the page keeps there is never replaced: it may be newer than the saved copy).
 */
export function seedScript(c: Pick<KitchenConfig, 'deviceToken' | 'station'>): string {
  const set = (key: string, v: string | null) => (v ? `if (!localStorage.getItem(${JSON.stringify(key)})) localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(v)});` : '');
  return `${set(KDS_DEVICE_KEY, c.deviceToken)}${set(KDS_STATION_KEY, c.station)}true`;
}

/** Connecting to `serverId`: a different outlet starts again (new pairing, new station); the same one keeps them. */
export function forServer(c: KitchenConfig, serverUrl: string, serverId: string | null): KitchenConfig {
  const same = !c.serverId || !serverId || c.serverId === serverId;
  return { ...c, serverUrl, serverId: serverId ?? c.serverId, ...(same ? {} : { deviceToken: null, station: null }) };
}
export const DEFAULT_PORT = 7420;

/**
 * "192.168.1.4", "192.168.1.4:7420", "http://192.168.1.4:7420/kds" → "http://192.168.1.4:7420". Only http(s), a host
 * and a port: the address of the outlet server, nothing else. Null when it is not one.
 */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null;
  // URL drops a port typed as the scheme's default (":80"), so u.port is empty both then and when none was typed
  const portTyped = /^https?:\/\/[^/?#]*:\d+/i.test(withScheme);
  const port = u.port || (!portTyped && u.protocol === 'http:' ? String(DEFAULT_PORT) : '');
  return `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}`;
}

/** The kitchen display on that server. */
export const kdsUrl = (serverUrl: string): string => `${serverUrl}/kds`;

/** Whether the kitchen window may go to `url`: the server's own pages only (no other site, no file:). */
export function mayOpen(url: string, serverUrl: string | null): boolean {
  if (!serverUrl) return false;
  try {
    return new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

export function parseConfig(text: string | null): KitchenConfig {
  if (!text) return { ...DEFAULT_CONFIG };
  try {
    const j = JSON.parse(text) as Partial<KitchenConfig>;
    return {
      serverUrl: typeof j.serverUrl === 'string' ? normalizeServerUrl(j.serverUrl) : null,
      autoStart: typeof j.autoStart === 'boolean' ? j.autoStart : DEFAULT_CONFIG.autoStart,
      serverId: token(j.serverId, 64),
      deviceToken: token(j.deviceToken, 512),
      station: token(j.station, 64),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
