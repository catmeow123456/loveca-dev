/**
 * Card image service
 *
 * Provides card image URL generation and preloading.
 * Supports self-hosted image storage (via Nginx proxy to MinIO) and local fallback.
 */

import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';

// ============================================
// Configuration
// ============================================

/** Base URL for images (proxied via Nginx to MinIO) */
const IMAGES_BASE_URL =
  import.meta.env.VITE_API_BASE_URL
    ? `${import.meta.env.VITE_API_BASE_URL}/images`
    : null;

/** Image size type */
export type ImageSize = 'thumb' | 'medium' | 'large';

/** Whether remote image storage is enabled */
export const isStorageEnabled = !!IMAGES_BASE_URL;

// ============================================
// URL 生成
// ============================================

/**
 * 获取卡牌图片 URL
 *
 * @param cardCode 卡牌编号 (如 PL-sd1-001)
 * @param size 图片尺寸 (thumb: 100px, medium: 300px, large: 600px)
 * @returns 图片 URL
 *
 * @example
 * getCardImageUrl('PL-sd1-001', 'medium')
 * // => 'https://xxx.supabase.co/storage/v1/object/public/loveca-cards/medium/PL-sd1-001.webp'
 */
export function getCardImageUrl(cardCode: string, size: ImageSize = 'medium'): string {
  if (IMAGES_BASE_URL) {
    const encodedCode = encodeURIComponent(cardCode);
    return `${IMAGES_BASE_URL}/${size}/${encodedCode}.webp`;
  }

  // 降级到本地静态文件
  return `/card/${cardCode}.jpg`;
}

/**
 * 获取卡背图片 URL
 */
export function getCardBackUrl(size: ImageSize = 'medium'): string {
  if (IMAGES_BASE_URL) {
    return `${IMAGES_BASE_URL}/${size}/back.webp`;
  }
  return '/back.jpg';
}

/**
 * 获取静态资源 URL (deck.png, back.jpg, icon.jpg 等)
 * 
 * @param assetName 资源文件名 (如 deck.png, back.jpg)
 * @returns 资源 URL
 * 
 * @example
 * getStaticAssetUrl('deck.png')
 * // => 'https://xxx.supabase.co/storage/v1/object/public/loveca-cards/static/deck.png'
 */
export function getStaticAssetUrl(assetName: string): string {
  if (IMAGES_BASE_URL) {
    return `${IMAGES_BASE_URL}/static/${assetName}`;
  }
  // 降级到本地静态文件
  return `/${assetName}`;
}

/**
 * 获取游戏桌图片 URL (deck.png)
 */
export function getDeckBackUrl(): string {
  return getStaticAssetUrl('deck.png');
}

/**
 * 根据显示尺寸自动选择合适的图片尺寸
 *
 * @param displaySize UI 组件的尺寸 ('sm' | 'md' | 'lg' | 'responsive')
 * @returns 推荐的图片尺寸
 */
export function getRecommendedImageSize(displaySize: 'sm' | 'md' | 'lg' | 'responsive'): ImageSize {
  switch (displaySize) {
    case 'sm':
      return 'thumb';
    case 'md':
    case 'responsive':
      return 'medium';
    case 'lg':
      return 'large';
    default:
      return 'medium';
  }
}

// ============================================
// 图片预加载
// ============================================

/** 预加载缓存 (避免重复加载) */
const preloadedImages = new Set<string>();

/**
 * 预加载单张图片
 *
 * @param url 图片 URL
 * @returns Promise，图片加载完成后 resolve
 */
export function preloadImage(url: string): Promise<void> {
  if (preloadedImages.has(url)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      preloadedImages.add(url);
      resolve();
    };
    img.onerror = () => {
      // 即使失败也标记为已尝试，避免重复请求
      preloadedImages.add(url);
      resolve();
    };
    img.src = url;
  });
}

/**
 * 批量预加载卡牌图片
 *
 * @param cardCodes 卡牌编号数组
 * @param size 图片尺寸
 * @param onProgress 进度回调
 * @returns Promise，所有图片加载完成后 resolve
 *
 * @example
 * // 预加载手牌
 * await preloadCardImages(['PL-sd1-001', 'PL-sd1-002'], 'medium');
 */
export async function preloadCardImages(
  cardCodes: string[],
  size: ImageSize = 'medium',
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const urls = cardCodes.map((code) => getCardImageUrl(code, size));
  const total = urls.length;
  let loaded = 0;

  await Promise.all(
    urls.map(async (url) => {
      await preloadImage(url);
      loaded++;
      onProgress?.(loaded, total);
    })
  );
}

/**
 * 预加载游戏开始时需要的图片
 *
 * @param handCardCodes 手牌卡牌编号
 * @param stageCardCodes 舞台卡牌编号
 */
export async function preloadGameImages(
  handCardCodes: string[],
  stageCardCodes: string[] = []
): Promise<void> {
  // 并行预加载
  await Promise.all([
    // 手牌使用 medium 尺寸
    preloadCardImages(handCardCodes, 'medium'),
    // 舞台卡牌使用 medium 尺寸
    preloadCardImages(stageCardCodes, 'medium'),
    // 卡背
    preloadImage(getCardBackUrl('medium')),
  ]);
}

// ============================================
// 响应式图片支持
// ============================================

/**
 * 生成响应式 srcSet 属性
 *
 * @param cardCode 卡牌编号
 * @returns srcSet 字符串，用于 <img> 标签
 *
 * @example
 * <img
 *   src={getCardImageUrl(cardCode, 'medium')}
 *   srcSet={getCardSrcSet(cardCode)}
 *   sizes="(max-width: 640px) 100px, (max-width: 1024px) 150px, 200px"
 * />
 */
export function getCardSrcSet(cardCode: string): string {
  if (!IMAGES_BASE_URL) {
    // 本地模式不支持响应式
    return '';
  }

  return [
    `${getCardImageUrl(cardCode, 'thumb')} 100w`,
    `${getCardImageUrl(cardCode, 'medium')} 300w`,
    `${getCardImageUrl(cardCode, 'large')} 600w`,
  ].join(', ');
}

/**
 * 推荐的 sizes 属性值
 * 用于响应式图片自动选择
 */
export const CARD_IMAGE_SIZES = '(max-width: 640px) 100px, (max-width: 1024px) 150px, 200px';

// ============================================
// 调试工具
// ============================================

/**
 * 检查图片是否可访问
 * 用于调试和监控
 */
export async function checkImageAvailability(cardCode: string): Promise<{
  thumb: boolean;
  medium: boolean;
  large: boolean;
}> {
  const checkUrl = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  };

  const [thumb, medium, large] = await Promise.all([
    checkUrl(getCardImageUrl(cardCode, 'thumb')),
    checkUrl(getCardImageUrl(cardCode, 'medium')),
    checkUrl(getCardImageUrl(cardCode, 'large')),
  ]);

  return { thumb, medium, large };
}

/**
 * 获取 Storage 状态信息
 */
export function getStorageInfo(): {
  enabled: boolean;
  baseUrl: string | null;
} {
  return {
    enabled: isStorageEnabled,
    baseUrl: IMAGES_BASE_URL,
  };
}

// ============================================
// 卡牌图片路径解析
// ============================================

/** 用于解析图片路径的最小卡牌信息 */
export interface CardImageInfo {
  cardCode: string;
  cardType?: CardType;
  imageFilename?: string | null;
}

/**
 * 根据卡牌数据解析图片路径
 * 
 * 整合了 imageFilename 字段处理，供组件使用
 *
 * @param cardData 卡牌数据（可为 undefined 或部分信息）
 * @param size 图片尺寸
 * @returns 图片 URL
 *
 * @example
 * // 在组件中使用
 * const imagePath = resolveCardImagePath(cardData, 'medium');
 * <Card cardData={cardData} imagePath={imagePath} />
 */
export function resolveCardImagePath(
  cardData: CardImageInfo | AnyCardData | undefined,
  size: ImageSize = 'medium'
): string {
  if (!cardData) {
    // 无卡牌数据时返回占位符
    return getCardBackUrl(size);
  }

  // 从卡牌数据获取 imageFilename
  const filename = cardData.imageFilename;
  
  // 提取文件名（去掉目录前缀和扩展名）作为图片基础名
  // imageFilename 可能含子目录如 "PR/LL-PR-001-PR.png"，Storage 中只用文件名部分
  const imageBaseName = filename
    ? filename.replace(/^.*\//, '').replace(/\.(jpg|jpeg|png|webp)$/i, '')
    : cardData.cardCode;

  // Use remote storage if configured
  if (isStorageEnabled) {
    // 使用 imageFilename 中的真实文件名（而非 cardCode）
    return getCardImageUrl(imageBaseName, size);
  }

  // 降级到本地静态文件
  const isEnergyCard = cardData.cardType === CardType.ENERGY;
  
  if (filename) {
    // 能量卡在 energy 目录
    if (isEnergyCard) {
      return `/energy/${filename}`;
    }
    // 其他卡牌在 card 目录
    return `/card/${filename}`;
  }
  
  // 降级：根据类型尝试直接用 cardCode
  if (isEnergyCard) {
    return `/energy/${cardData.cardCode}.png`;
  }
  return `/card/${cardData.cardCode}.jpg`;
}
