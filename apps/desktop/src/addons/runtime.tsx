// Add-on screens in the terminal (P5-01, ADR-0004). After sign-in the terminal asks the server which add-ons are on and
// loads each one's screens from app://dinepos/addons/<id>/ui.js (the main process serves them only after checking the
// signature itself). An add-on's ui.js calls window.__DINEPOS__.register(id, { nav, settings, overlay }) and uses the
// terminal's own React (its build maps `react` to window.__DINEPOS__.React), so hooks and context work.
import type { AddonInfo, CommandSuccess, Right } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import { useEffect, useSyncExternalStore, type ComponentType } from 'react';
import { useApp } from '../app-context.js';

/** What an add-on screen receives as `host`. */
export interface AddonHost {
  addonId: string;
  /** The add-on's own staff routes (`/v1/addons/<id>` + path) and its commands. */
  api: {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    command<R = unknown>(type: string, payload: unknown, opts?: { orderId?: string; expectedVersion?: number }): Promise<CommandSuccess<R>>;
  };
  /** Reads of DinePOS itself (e.g. `/v1/floor`, `/v1/menu`, `/v1/config`). */
  getCore<T>(path: string): Promise<T>;
  can(right: Right, withPin?: boolean): boolean;
  user: { id: string; name: string; role: string } | null;
  serverUrl: string;
  openOrder: (orderId: string) => void;
  /** Back to the floor. */
  back: () => void;
}

export interface AddonScreenProps {
  host: AddonHost;
}

export interface AddonRegistration {
  /** A button in the floor's top bar opening a full screen. */
  nav?: { label: string; title?: string; right?: Right; Screen: ComponentType<AddonScreenProps> };
  /** A section in Settings. */
  settings?: { label: string; hint?: string; right?: Right; Screen: ComponentType<AddonScreenProps> };
  /** Always mounted while signed in (alerts, banners). */
  overlay?: ComponentType<AddonScreenProps>;
}

const registrations = new Map<string, AddonRegistration>();
let snapshot: Array<[string, AddonRegistration]> = [];
const listeners = new Set<() => void>();

export function registerAddon(id: string, reg: AddonRegistration): void {
  if (!/^[a-z][a-z0-9]{1,19}$/.test(id) || !reg || typeof reg !== 'object') return;
  registrations.set(id, reg);
  snapshot = [...registrations.entries()];
  for (const l of listeners) l();
}

declare global {
  interface Window {
    __DINEPOS__?: { apiVersion: number; React: typeof React; ReactDOM: typeof ReactDOM; jsxRuntime: typeof jsxRuntime; register: typeof registerAddon };
  }
}
window.__DINEPOS__ = { apiVersion: 1, React, ReactDOM, jsxRuntime, register: registerAddon };

export function useAddonRegistrations(): Array<[string, AddonRegistration]> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** The app:// address of an add-on screen file for this outlet server. */
export function addonFileUrl(id: string, file: 'ui.js' | 'ui.css', serverUrl: string, sha: string): string {
  return `app://dinepos/addons/${id}/${file}?server=${encodeURIComponent(serverUrl)}&v=${sha.slice(0, 16)}`;
}

const injected = new Set<string>();

/** Loads the screens of the add-ons that are on (once per version). */
export function useAddonLoader(): AddonInfo[] {
  const { api, serverUrl, session } = useApp();
  const list = useQuery({ queryKey: ['addons'], queryFn: () => api.get<{ addons: AddonInfo[] }>('/v1/addons'), enabled: !!session, staleTime: 5 * 60_000 });
  const addons = list.data?.addons ?? [];
  useEffect(() => {
    for (const a of addons) {
      if (a.status !== 'on' || !a.ui) continue;
      const key = `${serverUrl}|${a.id}|${a.ui.script}`;
      if (injected.has(key)) continue;
      injected.add(key);
      if (a.ui.style) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = addonFileUrl(a.id, 'ui.css', serverUrl, a.ui.style);
        link.dataset.addon = a.id;
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = addonFileUrl(a.id, 'ui.js', serverUrl, a.ui.script);
      script.async = true;
      script.dataset.addon = a.id;
      script.onerror = () => console.warn(`The ${a.name} add-on screens could not be loaded.`);
      document.head.appendChild(script);
    }
  }, [addons, serverUrl]);
  return addons;
}

/** The `host` an add-on screen gets. */
export function useAddonHost(addonId: string, nav: { openOrder: (orderId: string) => void; back: () => void }): AddonHost {
  const { api, serverUrl, session, can } = useApp();
  const base = `/v1/addons/${addonId}`;
  return React.useMemo<AddonHost>(
    () => ({
      addonId,
      api: {
        get: (path) => api.get(`${base}${path}`),
        post: (path, body) => api.send('POST', `${base}${path}`, body ?? {}),
        command: (type, payload, opts) => api.command(type, payload, opts),
      },
      getCore: (path) => api.get(path),
      can,
      user: session ? { id: session.user.id, name: session.user.name, role: session.user.roleName } : null,
      serverUrl,
      openOrder: nav.openOrder,
      back: nav.back,
    }),
    [api, base, can, session, serverUrl, addonId],
  );
}

/** Renders an add-on component, keeping a broken one from taking the terminal down. */
export class AddonBoundary extends React.Component<{ name: string; children: React.ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="m-6 rounded-xl border border-danger bg-card p-4 text-sm">
          The {this.props.name} add-on hit a problem: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

export function AddonView({ id, reg, Comp, nav }: { id: string; reg?: AddonRegistration; Comp: ComponentType<AddonScreenProps>; nav: { openOrder: (orderId: string) => void; back: () => void } }) {
  const host = useAddonHost(id, nav);
  return (
    <AddonBoundary name={reg?.nav?.label ?? id}>
      <Comp host={host} />
    </AddonBoundary>
  );
}
