import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as Minio from 'minio';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(SCRIPT_DIR, '..', 'assets', 'emotes', 'seed');
const manifest = JSON.parse(await readFile(join(SEED_DIR, 'manifest.json'), 'utf8'));

const client = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});
const bucket = process.env.MINIO_BUCKET || 'loveca-cards';

if (!(await client.bucketExists(bucket))) {
  throw new Error(`MinIO bucket does not exist: ${bucket}`);
}

const filenames = [
  ...new Set(
    manifest.flatMap((entry) => [entry.staticFilename, entry.animatedFilename]).filter(Boolean)
  ),
];

for (const filename of filenames) {
  const objectKey = `emotes/${filename}`;
  const filePath = join(SEED_DIR, filename);
  const buffer = await readFile(filePath);
  try {
    const existing = await client.statObject(bucket, objectKey);
    if (existing.size !== buffer.length) {
      throw new Error(
        `Existing object size mismatch for ${objectKey}: ${existing.size} != ${buffer.length}`
      );
    }
    const remoteHash = await hashStream(await client.getObject(bucket, objectKey));
    const expectedHash = filename.replace(/\.webp$/u, '');
    if (remoteHash !== expectedHash) {
      throw new Error(
        `Existing object hash mismatch for ${objectKey}: ${remoteHash} != ${expectedHash}`
      );
    }
    process.stdout.write(`exists ${objectKey}\n`);
  } catch (error) {
    if (!isMissingObject(error)) {
      throw error;
    }
    await client.putObject(bucket, objectKey, buffer, buffer.length, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    process.stdout.write(`uploaded ${objectKey}\n`);
  }
}

function isMissingObject(error) {
  return error?.code === 'NoSuchKey' || error?.code === 'NotFound';
}

async function hashStream(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}
