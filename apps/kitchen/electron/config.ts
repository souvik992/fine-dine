// DinePOS Kitchen: where the outlet server is, and what this kitchen PC may open. Pure (tested).

export interface KitchenConfig {
  /** The outlet server, e.g. "http://192.168.1.4:7420" (no path). */
  serverUrl: string | null;
  /** Open by itself when Windows starts (on by default: a kitchen PC is switched on, not operated). */
  autoStart: boolean;
}

export const DEFAULT_CONFIG: KitchenConfig = { serverUrl: null, autoStart: true };
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
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
