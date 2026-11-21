// The captain app's connection to the outlet server: the shared web-app shell (@dinepos/web-shell) with the phone's
// settings — the floor, menu and every order's events. Nothing signs a phone out by itself (docs/07).
import { ShellProvider, useShell, type Shell, type ShellConfig } from '@dinepos/web-shell';
import type { ReactNode } from 'react';

export type { StreamState } from '@dinepos/web-shell';

const CAPTAIN: ShellConfig = {
  kind: 'captain',
  storagePrefix: 'dinepos.captain',
  topicQueries: { floor: ['floor'], menu: ['menu'], system: ['floor', 'setup'] },
  extraTopics: ['order:*'],
  onEvent: (e, refresh) => {
    if (e.topic.startsWith('order:')) refresh(['order', e.topic.slice(6)]);
  },
};

export function AppProvider({ children }: { children: ReactNode }) {
  return <ShellProvider config={CAPTAIN}>{children}</ShellProvider>;
}

export const useApp: () => Shell = useShell;
