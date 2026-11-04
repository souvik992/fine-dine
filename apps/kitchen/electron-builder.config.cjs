// Windows installer (NSIS) for DinePOS Kitchen. Built by `npm run dist -w @dinepos/kitchen` (scripts/dist.mjs).
const path = require('node:path');

const electronDir = path.dirname(require.resolve('electron/package.json'));

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.dinepos.kitchen',
  productName: 'DinePOS Kitchen',
  copyright: 'Copyright © 2026 DinePOS',
  directories: { app: '.stage', output: 'release' },
  electronVersion: require('electron/package.json').version,
  electronDist: path.join(electronDir, 'dist'),
  // Chromium's own text in English only (the kitchen display carries its own); saves ~48 MB.
  electronLanguages: ['en-US'],
  npmRebuild: false,
  nodeGypRebuild: false,
  asar: true,
  files: ['**/*', '!node_modules{,/**/*}', '!**/*.map'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'DinePOSKitchen',
    artifactName: 'DinePOS-Kitchen-Setup-${version}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DinePOS Kitchen',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
  },
};
