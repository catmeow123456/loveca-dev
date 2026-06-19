import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const image = process.env.BUBBLEWRAP_DOCKER_IMAGE || 'ghcr.io/googlechromelabs/bubblewrap:latest';
const projectDir = path.resolve('android/twa/loveca');
const keystorePassword = process.env.BUBBLEWRAP_KEYSTORE_PASSWORD;
const keyPassword = process.env.BUBBLEWRAP_KEY_PASSWORD;
const skipPwaValidation = process.env.ANDROID_TWA_SKIP_PWA_VALIDATION !== 'false';
const proxyUrl =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.HTTP_PROXY ||
  '';
const gradleCacheVolume =
  process.env.ANDROID_TWA_GRADLE_CACHE_VOLUME || 'loveca-android-gradle-cache';
const twaManifest = JSON.parse(
  readFileSync(path.join(projectDir, 'twa-manifest.json'), 'utf8')
);
const appVersionName = String(twaManifest.appVersionName || twaManifest.appVersion || '').trim();
const appVersionCode = String(twaManifest.appVersionCode || '').trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}`);
  }
}

if (!keystorePassword) {
  fail('BUBBLEWRAP_KEYSTORE_PASSWORD is required.');
}

if (!keyPassword) {
  fail('BUBBLEWRAP_KEY_PASSWORD is required.');
}

if (!appVersionName) {
  fail('twa-manifest.json appVersionName is required.');
}

if (!appVersionCode) {
  fail('twa-manifest.json appVersionCode is required.');
}

function getProxyOptions(urlText) {
  if (!urlText) {
    return null;
  }

  try {
    const url = new URL(urlText);
    const host = url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const options = [
      `-Dhttp.proxyHost=${host}`,
      `-Dhttp.proxyPort=${port}`,
      `-Dhttps.proxyHost=${host}`,
      `-Dhttps.proxyPort=${port}`,
    ];

    if (url.username) {
      options.push(`-Dhttp.proxyUser=${decodeURIComponent(url.username)}`);
      options.push(`-Dhttps.proxyUser=${decodeURIComponent(url.username)}`);
    }

    if (url.password) {
      options.push(`-Dhttp.proxyPassword=${decodeURIComponent(url.password)}`);
      options.push(`-Dhttps.proxyPassword=${decodeURIComponent(url.password)}`);
    }

    return {
      host,
      gradleOpts: options.join(' '),
      useHostNetwork: host === 'localhost' || host === '127.0.0.1' || host === '::1',
    };
  } catch {
    fail(`Invalid proxy URL: ${urlText}`);
  }
}

const buildFlags = skipPwaValidation ? ' --skipPwaValidation' : '';
const shellCommand = [
  'yes | /root/.bubblewrap/android_sdk/tools/bin/sdkmanager --sdk_root=/root/.bubblewrap/android_sdk --licenses >/tmp/android-sdk-licenses.log',
  'bubblewrap update --skipVersionUpgrade',
  `bubblewrap build${buildFlags}`,
].join(' && ');
const proxyOptions = getProxyOptions(proxyUrl);
const dockerArgs = [
  'run',
  '--rm',
  '-e',
  'BUBBLEWRAP_KEYSTORE_PASSWORD',
  '-e',
  'BUBBLEWRAP_KEY_PASSWORD',
  '-e',
  'http_proxy',
  '-e',
  'https_proxy',
  '-e',
  'HTTP_PROXY',
  '-e',
  'HTTPS_PROXY',
  '-e',
  'no_proxy',
  '-e',
  'NO_PROXY',
  '-v',
  `${projectDir}:/app`,
  '-v',
  `${gradleCacheVolume}:/root/.gradle`,
  '-w',
  '/app',
  '--entrypoint',
  'sh',
];

if (proxyOptions?.gradleOpts) {
  dockerArgs.push('-e', `GRADLE_OPTS=${proxyOptions.gradleOpts}`);
  dockerArgs.push('-e', `JAVA_TOOL_OPTIONS=${proxyOptions.gradleOpts}`);
}

if (proxyOptions?.useHostNetwork || process.env.ANDROID_TWA_DOCKER_NETWORK === 'host') {
  dockerArgs.push('--network', 'host');
}

dockerArgs.push(image, '-lc', shellCommand);

run('docker', dockerArgs);

if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
  run('docker', [
    'run',
    '--rm',
    '-v',
    `${projectDir}:/app`,
    '--entrypoint',
    'chown',
    image,
    '-R',
    `${process.getuid()}:${process.getgid()}`,
    '/app',
  ]);
}
