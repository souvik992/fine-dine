import { LoginScreen, PairScreen } from '@dinepos/web-shell';
import { useApp } from './app-context.js';
import { TablesScreen } from './screens/TablesScreen.js';

/** Pair the phone → sign in with a PIN → tables (docs/09 Captain). */
export function App() {
  const { needsPairing, session } = useApp();
  if (needsPairing) return <PairScreen kind="captain" />;
  if (!session) return <LoginScreen question="Who is taking orders?" />;
  return <TablesScreen />;
}
