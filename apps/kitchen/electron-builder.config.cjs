// Installers for DinePOS Kitchen: Windows (NSIS) and macOS (universal .dmg, built on a Mac). Built by `npm run dist -w @dinepos/kitchen` (scripts/dist.mjs).
const path = require('node:path');

const electronDir = path.dirname(require.resolve('electron/package.json'));

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.dinepos.kitchen',
  productName: 'DinePOS Kitchen',
  copyright: 'Copyright © 2026 DinePOS',
  directories: { app: '.stage', output: 'release' },
  electronVersion: require('electron/package.json').version,
  // Windows: the Electron already in node_modules. Mac: electron-builder downloads (checksum-verified) the arm64 and x64
  // Electron for the two halves of the universal app; node_modules holds only the build machine's one.
  electronDist: process.platform === 'darwin' ? undefined : path.join(electronDir, 'dist'),
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
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }],
    category: 'public.app-category.business',
    icon: '../desktop/build/icon.png',
    artifactName: 'DinePOS-Kitchen-${version}-mac.${ext}',
    identity: process.env.CSC_LINK || process.env.CSC_NAME ? undefined : '-',
    hardenedRuntime: true,
    entitlements: '../desktop/build/entitlements.mac.plist',
    entitlementsInherit: '../desktop/build/entitlements.mac.plist',
    notarize: Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID),
    extendInfo: { NSLocalNetworkUsageDescription: 'DinePOS Kitchen finds and connects to the DinePOS Server on your restaurant network.' },
  },
  dmg: {
    title: 'DinePOS Kitchen ${version}',
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
    shortcutName: 'DinePOS Kitchen',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    include: 'build/installer.nsh',
  },
};
