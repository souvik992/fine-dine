import { useApp } from './app-context.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { PairScreen } from './screens/PairScreen.js';
import { TablesScreen } from './screens/TablesScreen.js';

/** Pair the phone → sign in with a PIN → tables (docs/09 Captain). */
export function App() {
  const { needsPairing, session } = useApp();
  if (needsPairing) return <PairScreen />;
  if (!session) return <LoginScreen />;
  return <TablesScreen />;
}
