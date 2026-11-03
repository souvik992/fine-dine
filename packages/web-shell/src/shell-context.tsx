// A web app's connection to the outlet server it was loaded from (captain P3-01, kitchen display P4-02): device token
// (pairing, P2-02), staff sign-in, the API client and the live stream. Same origin, so no server address to type.
import { ApiClient, StreamClient, type StreamEvent } from '@dinepos/client';
import type { LoginResult, Right } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ShellConfig {
  /** Device kind asked for when pairing. */
  kind: 'captain' | 'kds';
  /** localStorage prefix: `<prefix>.device`, `<prefix>.session`. */
  storagePrefix: string;
  /** Stream topic → cached GETs it refreshes (events are triggers; data comes from GETs, docs/04). */
  topicQueries: Record<string, string[]>;
  /** Extra topics, e.g. `order:*`, handled by `onEvent`. */
  extraTopics?: string[];
  onEvent?: (e: StreamEvent, refresh: (queryKey: unknown[]) => void) => void;
  /** Sign out after this long without a touch (docs/07: 10 minutes on phones); null = never (kitchen screen). */
  idleLockMs: number | null;
}

export type StreamState = 'connecting' | 'live' | 'offline';

export interface Shell {
  api: ApiClient;
  session: LoginResult | null;
  needsPairing: boolean;
  stream: StreamState;
  signIn: (r: LoginResult) => void;
  signOut: () => void;
  setDeviceToken: (token: string) => void;
  can: (right: Right) => boolean;
}

const ShellCtx = createContext<Shell | null>(null);

function store(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
const load = <T,>(key: string): T | null => {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export function ShellProvider({ config, children }: { config: ShellConfig; children: ReactNode }) {
  const qc = useQueryClient();
  const deviceKey = `${config.storagePrefix}.device`;
  const sessionKey = `${config.storagePrefix}.session`;
  const [device, setDevice] = useState<string | null>(() => store()?.getItem(deviceKey) ?? null);
  const [session, setSession] = useState<LoginResult | null>(() => load<LoginResult>(sessionKey));
  // The server decides: an unknown device gets 401 device_not_paired (the master PC itself needs no token).
  const [needsPairing, setNeedsPairing] = useState(false);
  const [stream, setStream] = useState<StreamState>('connecting');
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const configRef = useRef(config);
  configRef.current = config;

  const dropSession = useCallback(() => {
    store()?.removeItem(sessionKey);
    setSession(null);
  }, [sessionKey]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: window.location.origin,
        getToken: () => sessionRef.current?.token ?? null,
        getDeviceToken: () => deviceRef.current,
        onUnauthenticated: dropSession,
        onDeviceUnpaired: () => setNeedsPairing(true),
      }),
    [dropSession],
  );

  useEffect(() => {
    const { topicQueries, extraTopics = [] } = configRef.current;
    const refresh = (queryKey: unknown[]) => void qc.invalidateQueries({ queryKey });
    const s = new StreamClient({
      url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/v1/stream`,
      topics: [...Object.keys(topicQueries), ...extraTopics],
      deviceToken: () => deviceRef.current,
      onUnpaired: () => setNeedsPairing(true),
      onEvent: (e) => {
        configRef.current.onEvent?.(e, refresh);
        for (const k of configRef.current.topicQueries[e.topic] ?? []) refresh([k]);
      },
      onResync: () => void qc.invalidateQueries(),
      onStatus: (st) => {
        setStream(st);
        if (st === 'live') void qc.invalidateQueries();
      },
    });
    s.start();
    return () => s.stop();
  }, [device, qc]);

  // Idle lock: any touch keeps the person signed in.
  const idleLockMs = config.idleLockMs;
  useEffect(() => {
    if (!session || idleLockMs === null) return;
    let timer = setTimeout(dropSession, idleLockMs);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(dropSession, idleLockMs);
    };
    for (const e of ['pointerdown', 'keydown'] as const) window.addEventListener(e, bump, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of ['pointerdown', 'keydown'] as const) window.removeEventListener(e, bump);
    };
  }, [session, dropSession, idleLockMs]);

  const value = useMemo<Shell>(
    () => ({
      api,
      session,
      needsPairing,
      stream,
      signIn: (r) => {
        store()?.setItem(sessionKey, JSON.stringify(r));
        setSession(r);
      },
      signOut: () => {
        void api.send('DELETE', '/v1/session').catch(() => undefined);
        dropSession();
      },
      setDeviceToken: (token) => {
        store()?.setItem(deviceKey, token);
        setDevice(token);
        setNeedsPairing(false);
        void qc.invalidateQueries();
      },
      can: (right) => session?.rights.some((r) => r.right === right && !r.needsPin) ?? false,
    }),
    [api, session, needsPairing, stream, dropSession, qc, sessionKey, deviceKey],
  );
  return <ShellCtx.Provider value={value}>{children}</ShellCtx.Provider>;
}

export function useShell(): Shell {
  const v = useContext(ShellCtx);
  if (!v) throw new Error('useShell outside ShellProvider');
  return v;
}
