# @dinepos/web-shell

What the web apps served by the outlet server have in common (P4-02, taken out of the captain app):

- `ShellProvider` / `useShell()`: same-origin `ApiClient`, the device token from pairing, staff sign-in kept in
  `localStorage` under the app's prefix, the `/v1/stream` WebSocket (topics → React Query refreshes), an optional idle
  lock, and `can(right)`.
- `PairScreen`: name + 6-digit code a manager approves in Settings › Devices (docs/07).
- `LoginScreen`: name tiles, then a big PIN pad (the captain app; kitchen screens need no sign-in).

Used by `apps/captain` (phone) and `apps/kds` (kitchen screen). Each app adds `@source` for this folder in its
stylesheet so Tailwind sees the classes, and defines the `btn`, `input`, `tab` component classes.
