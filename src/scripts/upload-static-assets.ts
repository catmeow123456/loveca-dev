/**
 * 静态资源上传到 MinIO 脚本
 *
 * 将静态资源（deck.png, back.jpg 等）上传到 MinIO 对象存储
 *
 * 使用方法:
 * MINIO_ENDPOINT=localhost MINIO_ACCESS_KEY=xxx MINIO_SECRET_KEY=xxx npx tsx src/scripts/upload-static-assets.ts
 *
 * 环境变量:
 * - MINIO_ENDPOINT: MinIO 服务器地址 (必需)
 * - MINIO_PORT: MinIO 端口 (默认 9000)
 * - MINIO_ACCESS_KEY: 访问密钥 (必需)
 * - MINIO_SECRET_KEY: 密钥 (必需)
 * - MINIO_BUCKET: Bucket 名称 (默认 loveca-cards)
 * - MINIO_USE_SSL: 是否使用 SSL (默认 false)
 */

import * as fs from 'fs';
import * as Minio from 'minio';

// ============================================
// 配置
// ============================================

const CONFIG = {
  endpoint: process.env.MINIO_ENDPOINT!,
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
  bucket: process.env.MINIO_BUCKET ?? 'loveca-cards',
  useSSL: process.env.MINIO_USE_SSL === 'true',
};

// 待上传的静态资源列表
const STATIC_ASSETS = [
  { localPath: 'assets/deck.png', remotePath: 'static/deck.png', contentType: 'image/png' },
  { localPath: 'assets/back.jpg', remotePath: 'static/back.jpg', contentType: 'image/jpeg' },
  { localPath: 'assets/icon.jpg', remotePath: 'static/icon.jpg', contentType: 'image/jpeg' },
];

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log('MinIO Static Assets Upload\n');

  // 1. 检查环境变量
  if (!CONFIG.endpoint || !CONFIG.accessKey || !CONFIG.secretKey) {
    console.error('Error: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY are required');
    console.log('\nUsage:');
    console.log(
      'MINIO_ENDPOINT=localhost MINIO_ACCESS_KEY=xxx MINIO_SECRET_KEY=xxx npx tsx src/scripts/upload-static-assets.ts'
    );
    process.exit(1);
  }

  // 2. 创建 MinIO 客户端
  const client = new Minio.Client({
    endPoint: CONFIG.endpoint,
    port: CONFIG.port,
    useSSL: CONFIG.useSSL,
    accessKey: CONFIG.accessKey,
    secretKey: CONFIG.secretKey,
  });

  // 3. 确保 bucket 存在
  const exists = await client.bucketExists(CONFIG.bucket);
  if (!exists) {
    console.log(`Creating bucket: ${CONFIG.bucket}`);
    await client.makeBucket(CONFIG.bucket);

    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${CONFIG.bucket}/*`],
        },
      ],
    };
    await client.setBucketPolicy(CONFIG.bucket, JSON.stringify(policy));
    console.log('Bucket created with public read policy\n');
  } else {
    console.log(`Bucket "${CONFIG.bucket}" exists\n`);
  }

  // 4. 上传静态资源
  console.log(`Uploading ${STATIC_ASSETS.length} static assets\n`);

  let successCount = 0;
  let failCount = 0;

  for (const asset of STATIC_ASSETS) {
    try {
      if (!fs.existsSync(asset.localPath)) {
        console.log(`  SKIP ${asset.localPath}: file not found`);
        failCount++;
        continue;
      }

      const fileBuffer = fs.readFileSync(asset.localPath);
      await client.putObject(CONFIG.bucket, asset.remotePath, fileBuffer, fileBuffer.length, {
        'Content-Type': asset.contentType,
      });

      console.log(`  OK   ${asset.localPath} -> ${asset.remotePath}`);
      successCount++;
    } catch (err) {
      console.log(`  FAIL ${asset.localPath}: ${err instanceof Error ? err.message : err}`);
      failCount++;
    }
  }

  // 5. 打印结果
  console.log('\nUpload complete!');
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
}

// 运行主函数
main().catch(console.error);
