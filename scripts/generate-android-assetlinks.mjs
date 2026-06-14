import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const packageName = process.env.ANDROID_PACKAGE_NAME?.trim();
const fingerprint = process.env.ANDROID_SHA256_FINGERPRINT?.trim().toUpperCase();
const outputPath =
  process.env.ANDROID_ASSETLINKS_OUTPUT?.trim() || 'assets/.well-known/assetlinks.json';
const fingerprintPattern = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!packageName) {
  fail('ANDROID_PACKAGE_NAME is required, for example xyz.lovelivefun.loveca.');
}

if (!fingerprint) {
  fail('ANDROID_SHA256_FINGERPRINT is required, for example AA:BB:... with 32 bytes.');
}

if (!fingerprintPattern.test(fingerprint)) {
  fail(
    'ANDROID_SHA256_FINGERPRINT must be an uppercase or lowercase colon-separated SHA-256 fingerprint.'
  );
}

const assetLinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: [fingerprint],
    },
  },
];

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(assetLinks, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
