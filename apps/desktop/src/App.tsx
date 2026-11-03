import type { SetupState } from '@dinepos/shared';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Settings } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from './api/client.js';
import { useApp } from './app-context.js';
import { LoginScreen } from './auth/LoginScreen.js';
import { PairScreen } from './auth/PairScreen.js';
import { ManagerPinDialog } from './auth/ManagerPinDialog.js';
import { LicenceBanner } from './components/LicenceBanner.js';
import { SetupScreen } from './auth/SetupScreen.js';
import { BillingScreen } from './billing/BillingScreen.js';
import { BookingsScreen } from './bookings/BookingsScreen.js';
import { BillRequests } from './floor/BillRequests.js';
import { FloorScreen } from './floor/FloorScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';
import { ReportsScreen } from './reports/ReportsScreen.js';
import { StockScreen } from './stock/StockScreen.js';

type Screen = { kind: 'floor' } | { kind: 'settings'; section?: string } | { kind: 'stock' } | { kind: 'reports' } | { kind: 'bookings' } | { kind: 'order'; orderId: string };

export function App() {
  const { api, session, needsPairing, can } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: 'floor' });
  const toFloor = () => setScreen({ kind: 'floor' });
  // Public: first-run setup or the staff list. Refetched whenever nobody is signed in.
  const setup = useQuery({ queryKey: ['setup-state'], queryFn: () => api.get<SetupState>('/v1/setup-state'), enabled: !session, retry: 1 });

  if (screen.kind === 'settings') return <SettingsScreen onBack={toFloor} initial={screen.section} />;
  if (needsPairing) return <PairScreen onSettings={() => setScreen({ kind: 'settings' })} />;

  if (!session) {
    if (setup.isError) {
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div role="alert" className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
            <p className="font-semibold">{setup.error instanceof ApiError ? setup.error.message : 'Cannot reach the outlet server.'}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn" onClick={() => void setup.refetch()}>
                <RefreshCw className="h-4 w-4" /> Try again
              </button>
              <button className="btn" onClick={() => setScreen({ kind: 'settings' })}>
                <Settings className="h-4 w-4" /> Server settings
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (!setup.data) return <p className="mt-24 text-center text-muted-foreground">Connecting…</p>;
    if (setup.data.setupNeeded) return <SetupScreen onDone={toFloor} />;
    return (
      <>
        <LoginScreen state={setup.data} onSettings={() => setScreen({ kind: 'settings' })} />
        <LicenceBanner />
      </>
    );
  }

  return (
    <>
      {screen.kind === 'order' ? (
        <BillingScreen key={screen.orderId} orderId={screen.orderId} onBack={toFloor} />
      ) : screen.kind === 'stock' ? (
        <StockScreen onBack={toFloor} />
      ) : screen.kind === 'reports' ? (
        <ReportsScreen onBack={toFloor} />
      ) : screen.kind === 'bookings' ? (
        <BookingsScreen onBack={toFloor} onOpenOrder={(orderId) => setScreen({ kind: 'order', orderId })} />
      ) : (
        <FloorScreen onSettings={() => setScreen({ kind: 'settings' })} onStock={() => setScreen({ kind: 'stock' })} onReports={() => setScreen({ kind: 'reports' })} onBookings={() => setScreen({ kind: 'bookings' })} onOpenOrder={(orderId) => setScreen({ kind: 'order', orderId })} />
      )}
      <BillRequests onOpen={(orderId) => setScreen({ kind: 'order', orderId })} hiddenOrderId={screen.kind === 'order' ? screen.orderId : undefined} compact={screen.kind !== 'floor'} />
      <LicenceBanner onOpen={can('admin') ? () => setScreen({ kind: 'settings', section: 'licence' }) : undefined} />
      <ManagerPinDialog />
    </>
  );
}
