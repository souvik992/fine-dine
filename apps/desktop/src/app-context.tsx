import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiClient } from './api/client.js';
import { loadServerUrl, saveServerUrl } from './api/settings.js';
import { StreamClient, streamUrl, type StreamStatus } from './api/stream.js';

interface AppContextValue {
  api: ApiClient;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  streamStatus: StreamStatus;
}

const Ctx = createContext<AppContextValue | null>(null);

/** Which cached GET each stream topic refreshes. Events are triggers; data always comes from GETs (docs/04). */
const TOPIC_QUERIES: Record<string, string[]> = { floor: ['floor'], printers: ['printers'], menu: ['menu'], system: ['health', 'floor'] };
const TOPICS = [...Object.keys(TOPIC_QUERIES), 'order:*'];

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

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [serverUrl, setUrl] = useState(() => loadServerUrl(storage(), window.location.search));
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const api = useMemo(() => new ApiClient({ baseUrl: serverUrl }), [serverUrl]);

  useEffect(() => {
    const stream = new StreamClient({
      url: streamUrl(serverUrl),
      topics: TOPICS,
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
  }, [serverUrl, queryClient]);

  const value = useMemo<AppContextValue>(
    () => ({
      api,
      serverUrl,
      streamStatus,
      setServerUrl: (url) => {
        const store = storage();
        const clean = store ? saveServerUrl(store, url) : url;
        queryClient.clear();
        setUrl(clean);
      },
    }),
    [api, serverUrl, streamStatus, queryClient],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
