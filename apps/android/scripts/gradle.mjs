// Builds or tests DinePOS for Android with the Gradle wrapper, finding a JDK and the Android SDK on this PC.
//   node scripts/gradle.mjs apk   → release/DinePOS-Captain-<version>.apk (signed; makes the signing key the first time)
//   node scripts/gradle.mjs test  → JVM unit tests
// JDK: JAVA_HOME, else the one inside Android Studio. SDK: ANDROID_HOME / ANDROID_SDK_ROOT, else the default place.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const task = process.argv[2];
if (task !== 'apk' && task !== 'test') {
  console.error('usage: node scripts/gradle.mjs apk|test');
  process.exit(2);
}

function firstExisting(list) {
  return list.find((p) => p && existsSync(p));
}

const javaHome = firstExisting([
  process.env.JAVA_HOME,
  win && 'C:\\Program Files\\Android\\Android Studio\\jbr',
  process.platform === 'darwin' && '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/android-studio/jbr',
]);
if (!javaHome) {
  console.error('No JDK found: install Android Studio (it brings one) or set JAVA_HOME to a JDK 17 or newer.');
  process.exit(1);
}
const sdk = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  win && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  path.join(homedir(), 'Library', 'Android', 'sdk'),
  path.join(homedir(), 'Android', 'Sdk'),
]);
if (!sdk) {
  console.error('No Android SDK found: install Android Studio, or set ANDROID_HOME.');
  process.exit(1);
}
writeFileSync(path.join(root, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '\\\\').replaceAll(':', '\\:')}\n`);

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk };

/** DinePOS's Android key (made by the Captain app's build): never a new one here, or devices refuse the update. */
function ensureKey() {
  if (existsSync(path.join(root, '..', 'captain-android', 'keystore.properties'))) return;
  console.error('DinePOS\x27s Android signing key is missing (apps/captain-android/keystore.properties). Restore it from the backup.');
  process.exit(1);
}

function gradle(args) {
  const cmd = win ? `"${path.join(root, 'gradlew.bat')}"` : './gradlew';
  // fixed task names only (nothing from outside), so one command line is safe; Windows needs a shell for a .bat
  const line = [cmd, ...args, '--console=plain'].join(' ');
  const r = win ? spawnSync(line, { cwd: root, stdio: 'inherit', env, shell: true }) : spawnSync(cmd, [...args, '--console=plain'], { cwd: root, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (task === 'test') {
  gradle(['testDebugUnitTest']);
} else {
  ensureKey();
  gradle(['assembleRelease']);
  const out = path.join(root, 'release');
  mkdirSync(out, { recursive: true });
  const built = path.join(root, 'app', 'build', 'outputs', 'apk', 'release');
  for (const f of readdirSync(built).filter((n) => n.endsWith('-release.apk'))) {
    copyFileSync(path.join(built, f), path.join(out, f));
    console.warn(`APK: ${path.relative(process.cwd(), path.join(out, f))}`);
  }
}
