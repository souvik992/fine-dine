import type { LoginResult, Right, SessionInfo } from '@dinepos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClient, type ApiError } from './api/client.js';
import { deviceTokenFromHash, loadDeviceToken, loadServerUrl, saveDeviceToken, saveServerUrl, servedByOutlet } from './api/settings.js';
import { StreamClient, streamUrl, type StreamStatus } from './api/stream.js';

/** The signed-in person on this terminal. */
export interface Session extends SessionInfo {
  token: string;
  /** Locked with the Lock button (here, in another window or before a restart): only this person's PIN continues. */
  locked?: boolean;
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
  /** The Lock button: keeps the sign-in and shows the lock screen until the same person's PIN. */
  lock: () => Promise<void>;
  /** Checks the signed-in person's PIN with the server and leaves the lock screen (throws ApiError). */
  unlock: (pin: string) => Promise<void>;
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
const TOPIC_QUERIES: Record<string, string[]> = { floor: ['floor', 'catalog'], printers: ['printers', 'catalog', 'failed-prints'], menu: ['menu', 'catalog'], system: ['health', 'floor', 'config', 'staff', 'roles'], stock: ['stock', 'purchases', 'recipes', 'stock-usage', 'stock-moves'], reservations: ['reservations', 'waitlist'], online: ['online', 'online-orders'] };
const TOPICS = [...Object.keys(TOPIC_QUERIES), 'order:*'];
const SESSION_KEY = 'dinepos.session';

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
  const [serverUrl, setUrl] = useState(() => loadServerUrl(storage(), window.location.search, servedByOutlet(window.location)));
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [session, setSession] = useState<Session | null>(loadSession);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [deviceToken, setDeviceTokenState] = useState(() => {
    // P7-04: a token handed over in the address (browser demo) is kept like a paired one, then taken off the address
    const handed = deviceTokenFromHash(window.location.hash);
    if (handed) {
      saveDeviceToken(storage(), serverUrl, handed);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return loadDeviceToken(storage(), serverUrl);
  });
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

  const saveSession = useCallback((s: Session | null) => {
    if (s) storage()?.setItem(SESSION_KEY, JSON.stringify(s));
    else storage()?.removeItem(SESSION_KEY);
    setSession(s);
  }, []);

  /** Shows the lock screen (keeps the sign-in; pending manager-PIN prompts are cancelled). */
  const markLocked = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.locked) return;
    setPinRequest((p) => {
      p?.resolve(null);
      return null;
    });
    saveSession({ ...s, locked: true });
  }, [saveSession]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: serverUrl,
        getToken: () => sessionRef.current?.token ?? null,
        onUnauthenticated: dropSession,
        onSessionLocked: markLocked,
        getDeviceToken: () => deviceRef.current,
        onDeviceUnpaired: () => setNeedsPairing(true),
        requestManagerPin: (err: ApiError) => new Promise((resolve) => setPinRequest({ message: err.message, resolve })),
      }),
    [serverUrl, dropSession, markLocked],
  );

  const signIn = useCallback((r: LoginResult) => saveSession({ ...r }), [saveSession]);

  const signOut = useCallback(() => {
    void api.send('DELETE', '/v1/session').catch(() => undefined);
    dropSession();
  }, [api, dropSession]);

  const lock = useCallback(async () => {
    // Out of reach of the server, the terminal still locks; the unlock then checks the PIN once the server is back.
    await api.send('POST', '/v1/session/lock').catch((e: ApiError) => {
      if (e.code !== 'NETWORK') throw e;
    });
    markLocked();
  }, [api, markLocked]);

  const unlock = useCallback(
    async (pin: string) => {
      const token = sessionRef.current?.token;
      if (!token) return;
      const info = await api.send<SessionInfo>('POST', '/v1/session/unlock', { pin });
      saveSession({ ...info, token });
    },
    [api, saveSession],
  );

  // Nothing signs the terminal out by itself (docs/07, as in Tiffin POS): the sign-in survives idle time, closing the
  // app and a restart, until Sign out (or the server ends it: person deactivated, PIN or role changed).

  // A stored session is checked with the server at start (and its rights refreshed): a session from an
  // earlier run, another server or a deactivated person must not look signed in.
  const sessionToken = session?.token ?? null;
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    api.get<SessionInfo>('/v1/session').then(
      (info) => {
        if (cancelled || sessionRef.current?.token !== sessionToken) return;
        // A lock made while the server was out of reach stays until the PIN is typed.
        saveSession({ ...info, token: sessionToken, locked: sessionRef.current.locked });
      },
      () => undefined, // UNAUTHENTICATED already dropped it; a network error keeps it until the server is back
    );
    return () => {
      cancelled = true;
    };
  }, [api, sessionToken, saveSession]);

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
      lock,
      unlock,
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
    [api, serverUrl, streamStatus, session, signIn, signOut, lock, unlock, pinRequest, queryClient, dropSession, needsPairing],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
