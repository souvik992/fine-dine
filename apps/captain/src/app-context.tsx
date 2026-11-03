// The captain app's connection to the outlet server: the shared web-app shell (@dinepos/web-shell) with the phone's
// settings — 10-minute idle lock (docs/07), the floor, menu and every order's events.
import { ShellProvider, useShell, type Shell, type ShellConfig } from '@dinepos/web-shell';
import type { ReactNode } from 'react';

export type { StreamState } from '@dinepos/web-shell';

/** Phones lock like terminals (docs/07): 10 idle minutes. */
export const IDLE_LOCK_MS = 10 * 60_000;

const CAPTAIN: ShellConfig = {
  kind: 'captain',
  storagePrefix: 'dinepos.captain',
  topicQueries: { floor: ['floor'], menu: ['menu'], system: ['floor', 'setup'] },
  extraTopics: ['order:*'],
  onEvent: (e, refresh) => {
    if (e.topic.startsWith('order:')) refresh(['order', e.topic.slice(6)]);
  },
  idleLockMs: IDLE_LOCK_MS,
};

export function AppProvider({ children }: { children: ReactNode }) {
  return <ShellProvider config={CAPTAIN}>{children}</ShellProvider>;
}

export const useApp: () => Shell = useShell;
