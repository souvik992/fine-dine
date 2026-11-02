// Windows installer (NSIS) for DinePOS. Built by `npm run dist -w @dinepos/desktop` (scripts/dist.mjs).
// The app itself comes from .stage/ (bundled main + renderer, no node_modules); the outlet server, its Node
// runtime and the service wrapper are extra resources under resources/server.
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
    { from: 'build-cache/WinSW.NET461.exe', to: 'server/DinePOS-Server.exe' },
    { from: 'build/service/DinePOS-Server.xml', to: 'server/DinePOS-Server.xml' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'DinePOS',
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
