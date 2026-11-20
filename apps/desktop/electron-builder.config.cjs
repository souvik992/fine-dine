// Windows installer (NSIS) for DinePOS. Built by `npm run dist -w @dinepos/desktop` (scripts/dist.mjs).
// The app itself comes from .stage/ (bundled main + renderer, no node_modules); the outlet server and its Node
// runtime are extra resources under resources/server (started by the "DinePOS Server" shortcut).
const path = require('node:path');

const electronDir = path.dirname(require.resolve('electron/package.json'));

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.dinepos.terminal',
  productName: 'DinePOS',
  copyright: 'Copyright © 2026 DinePOS',
  directories: { app: '.stage', output: 'release', buildResources: 'build' },
  electronVersion: require('electron/package.json').version,
  electronDist: path.join(electronDir, 'dist'),
  // Chromium's own text (context menus, file dialogs) in English only; DinePOS's screens carry their own text. Saves ~48 MB.
  electronLanguages: ['en-US'],
  npmRebuild: false,
  nodeGypRebuild: false,
  asar: true,
  // Main and renderer are fully bundled: no node_modules in the app archive.
  files: ['**/*', '!node_modules{,/**/*}', '!**/*.map'],
  extraResources: [
    { from: '../server/dist-bundle', to: 'server', filter: ['**/*', '!node_modules{,/**/*}', '!**/*.map'] },
    // electron-builder drops folders named node_modules unless they are listed on their own.
    { from: '../server/dist-bundle/node_modules', to: 'server/node_modules', filter: ['**/*'] },
  ],
  win: {
    extraResources: [
      { from: 'build-cache/node.exe', to: 'server/node.exe' },
      { from: 'build/server/stop-server.ps1', to: 'server/stop-server.ps1' },
    ],
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'DinePOS',
    // App, taskbar, installer and shortcut icon (orange tile, fork and knife), at 16–256 px.
    icon: 'build/icon.ico',
    artifactName: 'DinePOS-Setup-${version}.${ext}',
  },
  // macOS (built on a Mac: scripts/dist.mjs, or .github/workflows/mac-installers.yml). One universal app for Apple
  // silicon and Intel Macs, in a drag-to-Applications .dmg. "Install as master" is asked by the app at first start
  // (electron/mac-setup.ts). Signed with a Developer ID and notarized when CSC_LINK / APPLE_ID are set; otherwise
  // ad-hoc signed (macOS then asks to confirm the first open: see README "Mac installer").
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }],
    category: 'public.app-category.business',
    icon: 'build/icon.png',
    artifactName: 'DinePOS-${version}-mac.${ext}',
    // the universal Node binary (build-cache/mac/node) and both better-sqlite3 Mac builds are the same in the arm64 and
    // x64 halves: copied as they are, not joined again
    x64ArchFiles: 'Contents/Resources/server/**',
    extraResources: [{ from: 'build-cache/mac/node', to: 'server/node' }],
    identity: process.env.CSC_LINK || process.env.CSC_NAME ? undefined : '-',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID),
    extendInfo: {
      // the outlet server answers phones, kitchen screens and other terminals on the local network
      NSLocalNetworkUsageDescription: 'DinePOS connects to the DinePOS Server and printers on your restaurant network.',
    },
  },
  dmg: {
    title: 'DinePOS ${version}',
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DinePOS',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    include: 'build/installer.nsh',
  },
};
