// Cross-platform wrapper that invokes android/gradlew with the right tasks
// + environment (ANDROID_HOME, JAVA_HOME) so `npm run build:apk` / build:aab
// work on any dev box without forcing the user to remember the paths.
//
// Usage:  node scripts/gradle-build.mjs <task> [<task> ...]
//   e.g.  node scripts/gradle-build.mjs assembleDebug
//         node scripts/gradle-build.mjs assembleDebug bundleRelease
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const ANDROID_DIR = path.join(ROOT, 'android');

// Locate ANDROID_HOME: env var first, then common install paths
function findAndroidHome() {
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) {
    return process.env.ANDROID_HOME;
  }
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    '/usr/lib/android-sdk',
    '/opt/android-sdk',
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

// Locate JAVA_HOME: env var first, then Android Studio's bundled JBR
function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const candidates = [
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/usr/lib/jvm/java-17-openjdk-amd64',
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const tasks = process.argv.slice(2);
if (tasks.length === 0) {
  console.error('usage: node scripts/gradle-build.mjs <task> [<task> ...]');
  process.exit(1);
}

const androidHome = findAndroidHome();
const javaHome = findJavaHome();
if (!androidHome) {
  console.error('ANDROID_HOME not found — install Android SDK or set ANDROID_HOME');
  process.exit(1);
}
if (!javaHome) {
  console.error('JAVA_HOME not found — install a JDK or set JAVA_HOME');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const gradlew = path.join(ANDROID_DIR, isWin ? 'gradlew.bat' : 'gradlew');
if (!existsSync(gradlew)) {
  console.error(`gradlew not found at ${gradlew}`);
  process.exit(1);
}

console.log(`[gradle] ANDROID_HOME = ${androidHome}`);
console.log(`[gradle] JAVA_HOME    = ${javaHome}`);
console.log(`[gradle] tasks        = ${tasks.join(', ')}`);

const result = spawnSync(gradlew, tasks, {
  cwd: ANDROID_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    ANDROID_HOME: androidHome,
    JAVA_HOME: javaHome,
  },
  shell: false,
});
process.exit(result.status ?? 0);
