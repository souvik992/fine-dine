import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AppProvider } from './app-context.js';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <App />
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Keep the app itself available through Wi-Fi blips (public/sw.js). Not in the Vite dev server.
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/captain/sw.js', { scope: '/captain/' }).catch(() => undefined);
