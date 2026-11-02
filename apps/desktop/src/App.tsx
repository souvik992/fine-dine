import { useState } from 'react';
import { BillingScreen } from './billing/BillingScreen.js';
import { FloorScreen } from './floor/FloorScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';

type Screen = { kind: 'floor' } | { kind: 'settings' } | { kind: 'order'; orderId: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'floor' });
  const toFloor = () => setScreen({ kind: 'floor' });
  switch (screen.kind) {
    case 'settings':
      return <SettingsScreen onBack={toFloor} />;
    case 'order':
      return <BillingScreen key={screen.orderId} orderId={screen.orderId} onBack={toFloor} />;
    case 'floor':
      return <FloorScreen onSettings={() => setScreen({ kind: 'settings' })} onOpenOrder={(orderId) => setScreen({ kind: 'order', orderId })} />;
  }
}
