import { useState } from 'react';
import { FloorScreen } from './floor/FloorScreen.js';
import { SettingsScreen } from './settings/SettingsScreen.js';

type Screen = 'floor' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('floor');
  return screen === 'settings' ? <SettingsScreen onBack={() => setScreen('floor')} /> : <FloorScreen onSettings={() => setScreen('settings')} />;
}
