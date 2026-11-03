import type { LoginResult, Right, SessionInfo } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClient, type ApiError } from './api/client.js';
import { loadDeviceToken, loadServerUrl, saveDeviceToken, saveServerUrl } from './api/settings.js';
import { StreamClient, streamUrl, type StreamStatus } from './api/stream.js';

/** The signed-in person on this terminal. */
export interface Session extends SessionInfo {
  token: string;
}

/** A pending "manager PIN please" prompt (shown by ManagerPinDialog). */
export interface PinRequest {
  message: string;
  resolve: (pin: string | null) => void;
}

interface AppContextValue {
  api: ApiClient;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  streamStatus: StreamStatus;
  session: Session | null;
  signIn: (result: LoginResult) => void;
  /** Ends the session on the server and shows the sign-in screen. */
  signOut: () => void;
  /** Whether the signed-in role has a right; `withPin` also accepts rights that need a manager PIN. */
  can: (right: Right, withPin?: boolean) => boolean;
  pinRequest: PinRequest | null;
  /** P2-02: the server does not know this terminal; show the pairing screen. */
  needsPairing: boolean;
  /** Store the token a pairing produced and start again as a paired terminal. */
  setDeviceToken: (token: string | null) => void;
}

const Ctx = createContext<AppContextValue | null>(null);

/** Which cached GET each stream topic refreshes. Events are triggers; data always comes from GETs (docs/04). */
const TOPIC_QUERIES: Record<string, string[]> = { floor: ['floor', 'catalog'], printers: ['printers', 'catalog'], menu: ['menu', 'catalog'], system: ['health', 'floor', 'config', 'staff', 'roles'], stock: ['stock', 'purchases', 'recipes', 'stock-usage', 'stock-moves'] };
const TOPICS = [...Object.keys(TOPIC_QUERIES), 'order:*'];
const SESSION_KEY = 'dinepos.session';
/** docs/07: terminals sign out after 10 idle minutes. */
export const IDLE_LOCK_MS = 10 * 60_000;

/** Query keys a stream event should refresh. */
export function queriesFor(topic: string): unknown[][] {
  if (topic.startsWith('order:')) return [['order', topic.slice('order:'.length)]];
  return (TOPIC_QUERIES[topic] ?? []).map((k) => [k]);
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function loadSession(): Session | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [serverUrl, setUrl] = useState(() => loadServerUrl(storage(), window.location.search));
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [session, setSession] = useState<Session | null>(loadSession);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [deviceToken, setDeviceTokenState] = useState(() => loadDeviceToken(storage(), serverUrl));
  const deviceRef = useRef(deviceToken);
  deviceRef.current = deviceToken;
  const [needsPairing, setNeedsPairing] = useState(false);

  const dropSession = useCallback(() => {
    storage()?.removeItem(SESSION_KEY);
    setSession(null);
    setPinRequest((p) => {
      p?.resolve(null);
      return null;
    });
    queryClient.clear();
  }, [queryClient]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: serverUrl,
        getToken: () => sessionRef.current?.token ?? null,
        onUnauthenticated: dropSession,
        getDeviceToken: () => deviceRef.current,
        onDeviceUnpaired: () => setNeedsPairing(true),
        requestManagerPin: (err: ApiError) => new Promise((resolve) => setPinRequest({ message: err.message, resolve })),
      }),
    [serverUrl, dropSession],
  );

  const signIn = useCallback((r: LoginResult) => {
    const s: Session = { ...r };
    storage()?.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const signOut = useCallback(() => {
    void api.send('DELETE', '/v1/session').catch(() => undefined);
    dropSession();
  }, [api, dropSession]);

  // Idle lock: any key or pointer activity keeps the terminal signed in.
  useEffect(() => {
    if (!session) return;
    let timer = setTimeout(signOut, IDLE_LOCK_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(signOut, IDLE_LOCK_MS);
    };
    const events = ['keydown', 'pointerdown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [session, signOut]);

  // A stored session is checked with the server at start (and its rights refreshed): a session from an
  // earlier run, another server or a deactivated person must not look signed in.
  const sessionToken = session?.token ?? null;
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    api.get<SessionInfo>('/v1/session').then(
      (info) => {
        if (cancelled || sessionRef.current?.token !== sessionToken) return;
        const s: Session = { ...info, token: sessionToken };
        storage()?.setItem(SESSION_KEY, JSON.stringify(s));
        setSession(s);
      },
      () => undefined, // UNAUTHENTICATED already dropped it; a network error keeps it until the server is back
    );
    return () => {
      cancelled = true;
    };
  }, [api, sessionToken]);

  // Another window of this terminal signed in or out.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) setSession(loadSession());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const stream = new StreamClient({
      url: streamUrl(serverUrl),
      topics: TOPICS,
      deviceToken: () => deviceRef.current,
      onUnpaired: () => setNeedsPairing(true),
      onEvent: (e) => {
        for (const queryKey of queriesFor(e.topic)) void queryClient.invalidateQueries({ queryKey });
      },
      onResync: () => void queryClient.invalidateQueries(),
      onStatus: (s) => {
        setStreamStatus(s);
        // Back online: anything may have changed while we were away.
        if (s === 'live') void queryClient.invalidateQueries();
      },
    });
    stream.start();
    return () => stream.stop();
  }, [serverUrl, queryClient, deviceToken]);

  const value = useMemo<AppContextValue>(
    () => ({
      api,
      serverUrl,
      streamStatus,
      session,
      signIn,
      signOut,
      pinRequest: pinRequest && {
        message: pinRequest.message,
        resolve: (pin) => {
          pinRequest.resolve(pin);
          setPinRequest(null);
        },
      },
      needsPairing,
      setDeviceToken: (token) => {
        saveDeviceToken(storage(), serverUrl, token);
        setDeviceTokenState(token);
        setNeedsPairing(false);
        queryClient.clear();
      },
      can: (right, withPin = false) => session?.rights.some((r) => r.right === right && (withPin || !r.needsPin)) ?? false,
      setServerUrl: (url) => {
        const store = storage();
        const clean = store ? saveServerUrl(store, url) : url;
        if (clean !== serverUrl) dropSession(); // a session belongs to one server
        queryClient.clear();
        setUrl(clean);
        setDeviceTokenState(loadDeviceToken(store, clean)); // a token belongs to one server
        setNeedsPairing(false);
      },
    }),
    [api, serverUrl, streamStatus, session, signIn, signOut, pinRequest, queryClient, dropSession, needsPairing],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
