import * as Minio from 'minio';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

export const minioClient = new Minio.Client({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

const BUCKET = config.minio.bucket;
const WALLPAPER_BUCKET = config.minio.wallpaperBucket;
let wallpaperBucketReady = false;

/**
 * Ensure the bucket exists. Call once at startup.
 */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
    // Set public read policy
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKET}/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
    console.log(`Created MinIO bucket: ${BUCKET}`);
  }
}

/**
 * Ensure the player-wallpaper bucket exists without ever granting anonymous read access.
 */
export async function ensurePrivateWallpaperBucket(): Promise<void> {
  wallpaperBucketReady = false;
  const exists = await minioClient.bucketExists(WALLPAPER_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(WALLPAPER_BUCKET);
    wallpaperBucketReady = true;
    console.log(`Created private MinIO bucket: ${WALLPAPER_BUCKET}`);
    return;
  }

  try {
    const policy = JSON.parse(await minioClient.getBucketPolicy(WALLPAPER_BUCKET)) as {
      Statement?: Array<{
        Effect?: string;
        Principal?: unknown;
        Action?: string | string[];
      }>;
    };
    const hasAnonymousRead = (policy.Statement ?? []).some((statement) => {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      const principalText = JSON.stringify(statement.Principal);
      return (
        statement.Effect === 'Allow' &&
        actions.some(
          (action) =>
            action === '*' || action === 's3:*' || action?.toLowerCase().startsWith('s3:getobject')
        ) &&
        principalText.includes('*')
      );
    });
    if (hasAnonymousRead) {
      throw new Error(`Private wallpaper bucket ${WALLPAPER_BUCKET} allows anonymous reads`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'NoSuchBucketPolicy' && code !== 'NoSuchPolicy') {
      throw error;
    }
  }
  wallpaperBucketReady = true;
}

/**
 * Upload a buffer to MinIO.
 */
export async function uploadObject(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await minioClient.putObject(BUCKET, path, buffer, buffer.length, {
    'Content-Type': contentType,
  });
}

/**
 * Delete an object from MinIO.
 */
export async function deleteObject(path: string): Promise<void> {
  await minioClient.removeObject(BUCKET, path);
}

/**
 * Delete multiple objects from MinIO.
 */
export async function deleteObjects(paths: string[]): Promise<void> {
  await minioClient.removeObjects(BUCKET, paths);
}

/**
 * Check if an object exists.
 */
export async function objectExists(path: string): Promise<boolean> {
  try {
    await minioClient.statObject(BUCKET, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get an object stream from MinIO.
 */
export async function getObject(path: string): Promise<Readable> {
  return minioClient.getObject(BUCKET, path);
}

export async function uploadWallpaperObject(
  path: string,
  buffer: Buffer,
  contentType = 'image/webp'
): Promise<void> {
  assertWallpaperBucketReady();
  await minioClient.putObject(WALLPAPER_BUCKET, path, buffer, buffer.length, {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=86400, immutable',
  });
  const stored = await minioClient.statObject(WALLPAPER_BUCKET, path);
  if (stored.size !== buffer.length) {
    throw new Error('Wallpaper object verification failed');
  }
}

export async function getWallpaperObject(path: string): Promise<Readable> {
  assertWallpaperBucketReady();
  return minioClient.getObject(WALLPAPER_BUCKET, path);
}

export async function deleteWallpaperObjects(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  assertWallpaperBucketReady();
  await minioClient.removeObjects(WALLPAPER_BUCKET, [...paths]);
}

function assertWallpaperBucketReady(): void {
  if (!wallpaperBucketReady) {
    throw new Error('Private wallpaper storage is unavailable');
  }
}
