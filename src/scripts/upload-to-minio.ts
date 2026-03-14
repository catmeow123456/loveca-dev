/**
 * 图片上传到 MinIO 脚本
 *
 * 将压缩后的卡牌图片上传到 MinIO 对象存储
 *
 * 使用方法:
 * MINIO_ENDPOINT=localhost MINIO_ACCESS_KEY=xxx MINIO_SECRET_KEY=xxx npx tsx src/scripts/upload-to-minio.ts
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
import * as path from 'path';
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
  compressedDir: 'assets/compressed',
  concurrency: 5,
  checkConcurrency: 50,
};

// ============================================
// 类型定义
// ============================================

interface UploadResult {
  success: boolean;
  remotePath: string;
  error?: string;
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log('MinIO 图片上传工具\n');

  // 1. 检查环境变量
  if (!CONFIG.endpoint || !CONFIG.accessKey || !CONFIG.secretKey) {
    console.error('Error: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY are required');
    console.log('\nUsage:');
    console.log('MINIO_ENDPOINT=localhost MINIO_ACCESS_KEY=xxx MINIO_SECRET_KEY=xxx npx tsx src/scripts/upload-to-minio.ts');
    process.exit(1);
  }

  // 2. 检查压缩目录
  if (!fs.existsSync(CONFIG.compressedDir)) {
    console.error('Error: compressed directory not found');
    console.log('Run first: npx tsx src/scripts/compress-images.ts');
    process.exit(1);
  }

  // 3. 创建 MinIO 客户端
  const client = new Minio.Client({
    endPoint: CONFIG.endpoint,
    port: CONFIG.port,
    useSSL: CONFIG.useSSL,
    accessKey: CONFIG.accessKey,
    secretKey: CONFIG.secretKey,
  });

  // 4. 确保 bucket 存在
  await ensureBucketExists(client);

  // 5. 扫描所有子目录中的图片文件
  const sizeDirs = fs.readdirSync(CONFIG.compressedDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  console.log(`Found size directories: ${sizeDirs.join(', ')}\n`);

  // 6. 收集所有待上传文件
  const allTasks: { localPath: string; remotePath: string }[] = [];
  for (const size of sizeDirs) {
    const dirPath = path.join(CONFIG.compressedDir, size);
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.webp'));
    for (const file of files) {
      allTasks.push({
        localPath: path.join(dirPath, file),
        remotePath: `${size}/${file}`,
      });
    }
  }

  console.log(`Total ${allTasks.length} files to process\n`);

  // 7. 检查哪些文件已上传
  const uploadTasks = await filterUnuploadedFiles(client, allTasks);
  console.log(`Skipped (already uploaded): ${allTasks.length - uploadTasks.length}`);
  console.log(`Need upload: ${uploadTasks.length}\n`);

  // 8. 并发上传
  const results = await uploadWithConcurrency(client, uploadTasks, CONFIG.concurrency);

  // 9. 打印结果
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log('\n\nUpload complete!\n');
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  if (failCount > 0) {
    console.log('\nFailed files:');
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`  - ${r.remotePath}: ${r.error}`));
  }
}

/**
 * 过滤出未上传的文件
 */
async function filterUnuploadedFiles(
  client: Minio.Client,
  tasks: { localPath: string; remotePath: string }[]
): Promise<{ localPath: string; remotePath: string }[]> {
  const results: { task: { localPath: string; remotePath: string }; needsUpload: boolean }[] = [];
  let completed = 0;

  const queue = [...tasks];

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;

      let needsUpload = true;
      try {
        await client.statObject(CONFIG.bucket, task.remotePath);
        needsUpload = false;
      } catch {
        // Object doesn't exist, needs upload
      }

      results.push({ task, needsUpload });
      completed++;
      const progress = Math.round((completed / tasks.length) * 100);
      process.stdout.write(`\rChecking... ${completed}/${tasks.length} (${progress}%)`);
    }
  }

  const workers = Array.from({ length: CONFIG.checkConcurrency }, () => worker());
  await Promise.all(workers);

  console.log('');

  return results.filter((r) => r.needsUpload).map((r) => r.task);
}

/**
 * 确保 bucket 存在
 */
async function ensureBucketExists(client: Minio.Client) {
  const exists = await client.bucketExists(CONFIG.bucket);

  if (!exists) {
    console.log(`Creating bucket: ${CONFIG.bucket}`);
    await client.makeBucket(CONFIG.bucket);

    // Set public read policy
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
}

/**
 * 并发上传文件
 */
async function uploadWithConcurrency(
  client: Minio.Client,
  tasks: { localPath: string; remotePath: string }[],
  concurrency: number
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  let completed = 0;

  const queue = [...tasks];

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;

      const result = await uploadFile(client, task.localPath, task.remotePath);
      results.push(result);

      completed++;
      const progress = Math.round((completed / tasks.length) * 100);
      process.stdout.write(`\rUploading... ${completed}/${tasks.length} (${progress}%)`);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return results;
}

/**
 * 上传单个文件
 */
async function uploadFile(
  client: Minio.Client,
  localPath: string,
  remotePath: string
): Promise<UploadResult> {
  try {
    if (!fs.existsSync(localPath)) {
      return { success: false, remotePath, error: 'File not found' };
    }

    const fileBuffer = fs.readFileSync(localPath);

    await client.putObject(CONFIG.bucket, remotePath, fileBuffer, fileBuffer.length, {
      'Content-Type': 'image/webp',
    });

    return { success: true, remotePath };
  } catch (err) {
    return {
      success: false,
      remotePath,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// 运行主函数
main().catch(console.error);
