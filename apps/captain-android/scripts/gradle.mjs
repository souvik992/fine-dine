// Builds or tests DinePOS Captain for Android with the Gradle wrapper, finding a JDK and the Android SDK on this PC.
//   node scripts/gradle.mjs apk   → release/DinePOS-Captain-<version>.apk (signed; makes the signing key the first time)
//   node scripts/gradle.mjs test  → JVM unit tests
// JDK: JAVA_HOME, else the one inside Android Studio. SDK: ANDROID_HOME / ANDROID_SDK_ROOT, else the default place.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const keytool = path.join(javaHome, 'bin', win ? 'keytool.exe' : 'keytool');

/** The release signing key, made once. Phones only take an update signed with the same key: keep a backup. */
function ensureKey() {
  const props = path.join(root, 'keystore.properties');
  if (existsSync(props)) return;
  mkdirSync(path.join(root, 'keystore'), { recursive: true });
  const store = path.join(root, 'keystore', 'dinepos-captain.jks');
  const password = randomBytes(18).toString('base64url');
  const r = spawnSync(keytool, ['-genkeypair', '-keystore', store, '-storepass', password, '-keypass', password, '-alias', 'captain',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=DinePOS Captain'], { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeFileSync(props, `storeFile=keystore/dinepos-captain.jks\nstorePassword=${password}\nkeyAlias=captain\nkeyPassword=${password}\n`);
  process.stdout.write('\nMade the signing key: apps/captain-android/keystore/ + keystore.properties (not in git). Keep a copy safe:\n');
  process.stdout.write('phones only accept an update signed with this same key.\n\n');
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
  const version = /versionName\s*=\s*"([^"]+)"/.exec(readFileSync(path.join(root, 'app', 'build.gradle.kts'), 'utf8'))?.[1] ?? '0.0.0';
  const out = path.join(root, 'release');
  mkdirSync(out, { recursive: true });
  const target = path.join(out, `DinePOS-Captain-${version}.apk`);
  copyFileSync(path.join(root, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), target);
  process.stdout.write(`\nAPK: ${path.relative(process.cwd(), target)}\n`);
}
