import { ShellProvider, type ShellConfig } from '@dinepos/web-shell';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

/** A kitchen screen stays signed in (no idle lock) and listens to every station's tickets (topic `kds`). */
const KDS: ShellConfig = {
  kind: 'kds',
  storagePrefix: 'dinepos.kds',
  topicQueries: { kds: ['board'], menu: ['menu'], system: ['board', 'setup', 'menu'] },
  idleLockMs: null,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ShellProvider config={KDS}>
        <App />
      </ShellProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Keep the app itself available through Wi-Fi blips (public/sw.js). Not in the Vite dev server.
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/kds/sw.js', { scope: '/kds/' }).catch(() => undefined);
