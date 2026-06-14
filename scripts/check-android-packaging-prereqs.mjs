import { spawnSync } from 'node:child_process';
import process from 'node:process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function getMajorVersion(versionText) {
  const match = versionText.match(/(?:version ")?(\d+)(?:\.|")/);
  return match ? Number(match[1]) : null;
}

function printCheck(label, ok, detail) {
  const marker = ok ? 'OK' : 'MISSING';
  console.log(`${marker.padEnd(7)} ${label}${detail ? ` - ${detail}` : ''}`);
}

let failed = false;

const node = run('node', ['-v']);
const nodeMajor = getMajorVersion(node.output);
const nodeOk = node.ok && nodeMajor !== null && nodeMajor >= 20;
printCheck('Node.js >= 20', nodeOk, node.output);
failed ||= !nodeOk;

const pnpm = run('pnpm', ['-v']);
printCheck('pnpm', pnpm.ok, pnpm.output);
failed ||= !pnpm.ok;

const java = run('java', ['-version']);
const javaMajor = getMajorVersion(java.output);
const javaOk = java.ok && javaMajor !== null && javaMajor >= 17;
printCheck('JDK >= 17', javaOk, java.output.split('\n')[0]);
failed ||= !javaOk;

const androidSdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
printCheck('Android SDK env', Boolean(androidSdkRoot), androidSdkRoot);
failed ||= !androidSdkRoot;

const sdkmanager = run('sdkmanager', ['--version']);
printCheck('sdkmanager', sdkmanager.ok, sdkmanager.output.split('\n')[0]);
failed ||= !sdkmanager.ok;

const adb = run('adb', ['version']);
printCheck('adb', adb.ok, adb.output.split('\n')[0]);

const gradle = run('gradle', ['-v']);
printCheck(
  'Gradle command',
  gradle.ok,
  gradle.ok ? gradle.output.split('\n')[0] : 'optional if using Gradle wrapper'
);

if (failed) {
  console.error('\nAndroid TWA release packaging prerequisites are not fully satisfied.');
  process.exit(1);
}

console.log('\nAndroid TWA release packaging prerequisites look ready.');
