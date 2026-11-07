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
    { from: 'build-cache/node.exe', to: 'server/node.exe' },
    { from: 'build/server/stop-server.ps1', to: 'server/stop-server.ps1' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'DinePOS',
    // App, taskbar, installer and shortcut icon (orange tile, fork and knife), at 16–256 px.
    icon: 'build/icon.ico',
    artifactName: 'DinePOS-Setup-${version}.${ext}',
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
