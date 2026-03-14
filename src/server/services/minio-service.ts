import * as Minio from 'minio';
import { config } from '../config.js';

export const minioClient = new Minio.Client({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

const BUCKET = config.minio.bucket;

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
