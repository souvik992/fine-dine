// The captain app's connection to the outlet server it was loaded from: device token (pairing, P2-02), staff
// sign-in, the API client and the live stream. Same origin, so no server address to type.
import { ApiClient, StreamClient } from '@dinepos/client';
import type { LoginResult, Right } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const DEVICE_KEY = 'dinepos.captain.device';
const SESSION_KEY = 'dinepos.captain.session';
/** Phones lock like terminals (docs/07): 10 idle minutes. */
export const IDLE_LOCK_MS = 10 * 60_000;
/** Which cached GETs a stream topic refreshes (events are triggers; data comes from GETs, docs/04). */
const TOPIC_QUERIES: Record<string, string[]> = { floor: ['floor'], menu: ['menu'], system: ['floor', 'setup'] };

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

export type StreamState = 'connecting' | 'live' | 'offline';

interface Ctx {
  api: ApiClient;
  session: LoginResult | null;
  needsPairing: boolean;
  stream: StreamState;
  signIn: (r: LoginResult) => void;
  signOut: () => void;
  setDeviceToken: (token: string) => void;
  can: (right: Right) => boolean;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [device, setDevice] = useState<string | null>(() => store()?.getItem(DEVICE_KEY) ?? null);
  const [session, setSession] = useState<LoginResult | null>(() => load<LoginResult>(SESSION_KEY));
  // The server decides: an unknown device gets 401 device_not_paired (the master PC itself needs no token).
  const [needsPairing, setNeedsPairing] = useState(false);
  const [stream, setStream] = useState<StreamState>('connecting');
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const dropSession = useCallback(() => {
    store()?.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

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
    const s = new StreamClient({
      url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/v1/stream`,
      topics: [...Object.keys(TOPIC_QUERIES), 'order:*'],
      deviceToken: () => deviceRef.current,
      onUnpaired: () => setNeedsPairing(true),
      onEvent: (e) => {
        if (e.topic.startsWith('order:')) void qc.invalidateQueries({ queryKey: ['order', e.topic.slice(6)] });
        for (const k of TOPIC_QUERIES[e.topic] ?? []) void qc.invalidateQueries({ queryKey: [k] });
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

  // Idle lock: any touch keeps the captain signed in.
  useEffect(() => {
    if (!session) return;
    let timer = setTimeout(dropSession, IDLE_LOCK_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(dropSession, IDLE_LOCK_MS);
    };
    for (const e of ['pointerdown', 'keydown'] as const) window.addEventListener(e, bump, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of ['pointerdown', 'keydown'] as const) window.removeEventListener(e, bump);
    };
  }, [session, dropSession]);

  const value = useMemo<Ctx>(
    () => ({
      api,
      session,
      needsPairing,
      stream,
      signIn: (r) => {
        store()?.setItem(SESSION_KEY, JSON.stringify(r));
        setSession(r);
      },
      signOut: () => {
        void api.send('DELETE', '/v1/session').catch(() => undefined);
        dropSession();
      },
      setDeviceToken: (token) => {
        store()?.setItem(DEVICE_KEY, token);
        setDevice(token);
        setNeedsPairing(false);
        void qc.invalidateQueries();
      },
      can: (right) => session?.rights.some((r) => r.right === right && !r.needsPin) ?? false,
    }),
    [api, session, needsPairing, stream, dropSession, qc],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
