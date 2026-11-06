# @dinepos/captain-android — DinePOS Captain for Android

The captain app (`apps/captain`, served by the outlet server at `/captain`) as an installable Android app for the
waiters' phones. Nothing of the captain app is copied here: the app opens the server's page in a locked-down WebView, so
it is always the server's version, and the page's service worker keeps it working offline exactly as in Chrome.
It is a client only and never opens the database. Same idea as DinePOS Kitchen (`apps/kitchen`).

Plain Java, no libraries (only `org.json`, which is part of Android). minSdk 26 (Android 8), targetSdk 36.

## What it does
- First start: a setup screen asks for the main PC's address (checked with `GET /v1/health` before it is saved) and
  lists the DinePOS servers that answered on the Wi-Fi (P2-15 UDP probe), to pick one with a tap.
- Then the captain app opens full screen. Pairing and sign-in are kept by the page itself, as in a browser.
- The window may show only that server's pages (`ServerAddress.mayOpen`); other links are refused, and every
  permission request (camera, microphone, location, files) is denied. Back steps back in the page; on the first page it
  sends the app to the background.
- Server not there at start: the phone's copy of the captain app opens (offline outbox, docs/05). With no copy, the
  setup screen says why and tries again every 10 s.
- The main PC gets a new IP address (P2-15): at start, and every 15 s while the app is in front (after two missed
  health checks), the app looks for a server with the same id. It then:
  1. reads the unsent offline orders from the old address's IndexedDB (`dinepos-captain` / `outbox`; from the phone's
     copy when the old address is gone),
  2. puts the pairing (`dinepos.captain.device`) and those orders into the new address's storage (orders already there,
     by `commandId`, are skipped),
  3. opens the captain app there. The captain signs in with their PIN again; nobody re-pairs, and no order is left
     behind. A command sent twice is answered DUPLICATE, never applied twice.
  Another outlet's server never gets this phone's pairing or orders.
- Long-press the app icon › **Change the main PC** opens the setup screen.

## Build
- `npm run apk -w @dinepos/captain-android` → `apps/captain-android/release/DinePOS-Captain-<version>.apk` (signed).
- `npm run test -w @dinepos/captain-android` → JVM unit tests (`app/src/test`: address rules, discovery replies,
  saved config, page scripts).
- Needs Android Studio installed (its JDK and SDK are found automatically; or set `JAVA_HOME` / `ANDROID_HOME`).
  The project also opens in Android Studio as is.
- The first `apk` build makes the signing key: `keystore/` and `keystore.properties` (not in git). **Back them up.**
  Phones only take an update signed with the same key; a lost key means uninstalling and re-pairing every phone.
- Version: `versionCode` / `versionName` in `app/build.gradle.kts` (raise `versionCode` for every APK you hand out).

## Install on a phone
1. Copy the APK to the phone (USB, WhatsApp to yourself, or a shared drive) and open it. Allow "Install unknown apps"
   for the app you opened it from, when Android asks.
2. Open **DinePOS Captain**, pick the main PC from the list (or type its address from Settings › Devices on the
   billing PC), pair, and sign in with the captain's PIN.

Or with USB debugging: `adb install -r release/DinePOS-Captain-<version>.apk`. On the Android emulator the PC
running the server is `10.0.2.2`. The server list stays empty there, because broadcasts don't pass the emulator's
network.

## Limits
- Plain `http://` on the shop LAN (cleartext is allowed for that reason; `res/xml/network_security_config.xml`).
- targetSdk stays at 36: Android 17's local-network permission (for apps targeting 37) would need a runtime prompt.
  Add that prompt before raising it.
- The outbox carry-over depends on the captain app's IndexedDB layout (`apps/captain/src/offline/idb.ts`, version 1).
  If that changes, update `PageScripts.java` too.
- Many Android phones do not resolve `.local` names: use the IP address, and a router reservation (docs/01).
