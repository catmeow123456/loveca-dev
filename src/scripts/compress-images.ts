/**
 * 卡牌图片压缩脚本
 *
 * 将原始卡牌图片压缩为多个尺寸版本，使用 WebP 格式
 *
 * 使用方法:
 * npx tsx src/scripts/compress-images.ts
 * npx tsx src/scripts/compress-images.ts --source=llocg-db
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// ============================================
// 配置
// ============================================

const SOURCE = process.argv.find((a) => a.startsWith('--source='))?.split('=')[1] ?? 'crawler';

const IMAGE_SOURCE_DIRS: Record<string, string[]> = {
  crawler: ['test/images'],
  'llocg-db': ['llocg_db/img/cards', 'llocg_db/img/cards_cn'],
};

const CONFIG = {
  // 输入目录（根据 --source 参数选择）
  imageDirs: IMAGE_SOURCE_DIRS[SOURCE] ?? IMAGE_SOURCE_DIRS.crawler,
  // 输出目录
  outputDir: 'assets/compressed',
  // 尺寸配置 (宽度, 高度按比例缩放)
  sizes: {
    thumb: { width: 100, quality: 75 }, // 列表/网格预览
    medium: { width: 300, quality: 80 }, // 游戏中卡牌显示
    large: { width: 600, quality: 85 }, // 详情查看
  },
  // 卡牌背面图片
  backImage: 'assets/back.jpg',
};

// ============================================
// 类型定义
// ============================================

interface ImageInfo {
  inputPath: string;
  cardCode: string;
  type: 'card' | 'energy' | 'back';
}

interface CompressionResult {
  cardCode: string;
  size: string;
  originalSize: number;
  compressedSize: number;
  savings: string;
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log(`🎴 卡牌图片压缩工具 (source: ${SOURCE})\n`);

  // 1. 确保输出目录存在
  ensureOutputDirs();

  // 2. 收集所有图片
  const images = collectImages();
  console.log(`📁 找到 ${images.length} 张图片\n`);

  // 3. 压缩所有图片
  const results: CompressionResult[] = [];
  let processed = 0;
  let skipped = 0;

  for (const image of images) {
    try {
      const imageResults = await compressImage(image);
      if (imageResults.length > 0) {
        results.push(...imageResults);
        processed++;
      } else {
        skipped++;
      }

      // 显示进度
      const total = processed + skipped;
      const progress = Math.round((total / images.length) * 100);
      process.stdout.write(
        `\r⏳ 处理中... ${total}/${images.length} (${progress}%) - 已处理: ${processed}, 跳过: ${skipped}`
      );
    } catch (error) {
      console.error(`\n❌ 处理失败: ${image.cardCode}`, error);
    }
  }

  console.log('\n\n✅ 压缩完成!');
  console.log(`   📦 新处理: ${processed} 张`);
  console.log(`   ⏭️  跳过: ${skipped} 张 (已存在且未更新)\n`);

  // 4. 打印统计信息
  if (results.length > 0) {
    printStatistics(results);
  }

  // 5. 生成上传清单
  generateUploadManifest(images);
}

/**
 * 确保输出目录存在
 */
function ensureOutputDirs() {
  const dirs = [
    CONFIG.outputDir,
    ...Object.keys(CONFIG.sizes).map((size) => path.join(CONFIG.outputDir, size)),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📂 创建目录: ${dir}`);
    }
  }
}

/**
 * 收集所有需要处理的图片
 */
function collectImages(): ImageInfo[] {
  const images: ImageInfo[] = [];
  const seen = new Set<string>();

  // 扫描图片目录（支持子目录和扁平结构）
  for (const baseDir of CONFIG.imageDirs) {
    if (!fs.existsSync(baseDir)) {
      console.warn(`⚠️ 目录不存在: ${baseDir}`);
      continue;
    }

    const entries = fs.readdirSync(baseDir);
    for (const entry of entries) {
      const entryPath = path.join(baseDir, entry);

      if (fs.statSync(entryPath).isDirectory()) {
        // 子目录结构（如 BP01/*.png）
        const files = fs.readdirSync(entryPath);
        for (const file of files) {
          if (!/\.(jpg|jpeg|png|webp)$/i.test(file)) continue;
          const cardCode = path.basename(file, path.extname(file));
          if (!seen.has(cardCode)) {
            seen.add(cardCode);
            images.push({ inputPath: path.join(entryPath, file), cardCode, type: 'card' });
          }
        }
      } else if (/\.(jpg|jpeg|png|webp)$/i.test(entry)) {
        // 扁平结构（如 cards_cn/ 下直接是图片文件）
        const cardCode = path.basename(entry, path.extname(entry));
        if (!seen.has(cardCode)) {
          seen.add(cardCode);
          images.push({ inputPath: entryPath, cardCode, type: 'card' });
        }
      }
    }
  }

  // 处理卡背图片
  if (fs.existsSync(CONFIG.backImage)) {
    images.push({
      inputPath: CONFIG.backImage,
      cardCode: 'back',
      type: 'back',
    });
  }

  return images;
}

/**
 * 检查图片是否需要处理
 * 如果所有尺寸的输出文件都存在且比源文件新，则不需要处理
 */
function needsProcessing(image: ImageInfo): boolean {
  const inputMtime = fs.statSync(image.inputPath).mtimeMs;

  for (const sizeName of Object.keys(CONFIG.sizes)) {
    const outputPath = path.join(CONFIG.outputDir, sizeName, `${image.cardCode}.webp`);

    // 如果输出文件不存在，需要处理
    if (!fs.existsSync(outputPath)) {
      return true;
    }

    // 如果源文件比输出文件新，需要重新处理
    const outputMtime = fs.statSync(outputPath).mtimeMs;
    if (inputMtime > outputMtime) {
      return true;
    }
  }

  // 所有输出文件都存在且是最新的，不需要处理
  return false;
}

/**
 * 压缩单张图片为多个尺寸
 * 如果图片已处理过且源文件未更新，返回空数组表示跳过
 */
async function compressImage(image: ImageInfo): Promise<CompressionResult[]> {
  // 检查是否需要处理
  if (!needsProcessing(image)) {
    return [];
  }

  const results: CompressionResult[] = [];
  const originalSize = fs.statSync(image.inputPath).size;

  // 检测图片方向：横向图片（宽>高，即 Live 卡）需要顺时针旋转 90°
  const metadata = await sharp(image.inputPath).metadata();
  const isLandscape = metadata.width != null && metadata.height != null && metadata.width > metadata.height;

  for (const [sizeName, sizeConfig] of Object.entries(CONFIG.sizes)) {
    const outputPath = path.join(CONFIG.outputDir, sizeName, `${image.cardCode}.webp`);

    let pipeline = sharp(image.inputPath);

    // Live 卡（横向）顺时针旋转 90° 使其与成员卡尺寸一致
    if (isLandscape) {
      pipeline = pipeline.rotate(90);
    }

    await pipeline
      .resize(sizeConfig.width, null, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: sizeConfig.quality })
      .toFile(outputPath);

    const compressedSize = fs.statSync(outputPath).size;
    const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    results.push({
      cardCode: image.cardCode,
      size: sizeName,
      originalSize,
      compressedSize,
      savings: `${savings}%`,
    });
  }

  return results;
}

/**
 * 打印统计信息
 */
function printStatistics(results: CompressionResult[]) {
  const stats: Record<string, { count: number; totalOriginal: number; totalCompressed: number }> =
    {};

  for (const result of results) {
    if (!stats[result.size]) {
      stats[result.size] = { count: 0, totalOriginal: 0, totalCompressed: 0 };
    }
    stats[result.size].count++;
    stats[result.size].totalOriginal += result.originalSize;
    stats[result.size].totalCompressed += result.compressedSize;
  }

  console.log('📊 压缩统计:\n');
  console.log('| 尺寸 | 数量 | 原始大小 | 压缩后 | 节省 |');
  console.log('|------|------|----------|--------|------|');

  for (const [size, stat] of Object.entries(stats)) {
    const originalMB = (stat.totalOriginal / 1024 / 1024).toFixed(2);
    const compressedMB = (stat.totalCompressed / 1024 / 1024).toFixed(2);
    const savings = ((1 - stat.totalCompressed / stat.totalOriginal) * 100).toFixed(1);
    console.log(
      `| ${size.padEnd(6)} | ${stat.count.toString().padEnd(4)} | ${originalMB}MB | ${compressedMB}MB | ${savings}% |`
    );
  }

  const totalOriginal = Object.values(stats).reduce((sum, s) => sum + s.totalOriginal, 0);
  const totalCompressed = Object.values(stats).reduce((sum, s) => sum + s.totalCompressed, 0);
  console.log(
    `\n💾 总计: ${(totalOriginal / 1024 / 1024).toFixed(2)}MB → ${(totalCompressed / 1024 / 1024).toFixed(2)}MB`
  );
}

/**
 * 生成上传清单
 */
function generateUploadManifest(images: ImageInfo[]) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    sizes: Object.keys(CONFIG.sizes),
    files: images.map((img) => ({
      cardCode: img.cardCode,
      type: img.type,
      paths: Object.keys(CONFIG.sizes).map((size) => ({
        size,
        localPath: path.join(CONFIG.outputDir, size, `${img.cardCode}.webp`),
        remotePath: `${size}/${img.cardCode}.webp`,
      })),
    })),
  };

  const manifestPath = path.join(CONFIG.outputDir, 'upload-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n📋 上传清单已生成: ${manifestPath}`);
}

// 运行主函数
main().catch(console.error);
