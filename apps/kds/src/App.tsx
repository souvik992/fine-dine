import { PairScreen, useShell } from '@dinepos/web-shell';
import { useState } from 'react';
import { chosenStation } from './kds-model.js';
import { KdsScreen } from './screens/KdsScreen.js';
import { StationPicker } from './screens/StationPicker.js';

const STATION_KEY = 'dinepos.kds.station';
function saved(): string | null {
  try {
    return window.localStorage.getItem(STATION_KEY);
  } catch {
    return null;
  }
}

/**
 * Pair the screen → pick the station → tickets (docs/09 KDS). No sign-in after pairing (docs/06): a paired kitchen
 * screen may bump tickets and nothing else.
 */
export function App() {
  const { needsPairing } = useShell();
  const [station, setStation] = useState<string | null>(() => chosenStation(window.location.search, saved()));
  const choose = (id: string | null) => {
    try {
      if (id) window.localStorage.setItem(STATION_KEY, id);
      else window.localStorage.removeItem(STATION_KEY);
    } catch {
      // A private window: the choice lasts until the page is closed.
    }
    if (!id && window.location.search) window.history.replaceState(null, '', window.location.pathname);
    setStation(id);
  };
  if (needsPairing) return <PairScreen kind="kds" device="kitchen screen" placeholder="Tandoor screen" reason="Only paired screens can show kitchen tickets." />;
  if (!station) return <StationPicker onPick={choose} />;
  return <KdsScreen stationId={station} onChangeStation={() => choose(null)} />;
}
