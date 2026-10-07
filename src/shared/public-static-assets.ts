export type PublicStaticImageDelivery = 'FRONTEND' | 'OBJECT_STORAGE';

export interface PublicStaticImageAsset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly publicUrl: string;
  readonly objectKey: string | null;
  readonly delivery: PublicStaticImageDelivery;
}

/**
 * Public images that ship with the app or are mirrored by the static upload task.
 * The asset catalog and the upload task both consume this manifest so the list is
 * not maintained separately in the admin UI.
 */
export const PUBLIC_STATIC_IMAGE_ASSETS: readonly PublicStaticImageAsset[] = [
  {
    id: 'card-back',
    title: '卡背',
    description: '牌桌隐藏卡牌使用的公共卡背',
    publicUrl: '/back.jpg',
    objectKey: 'static/back.jpg',
    delivery: 'OBJECT_STORAGE',
  },
  {
    id: 'brand-mark',
    title: '平台图标',
    description: '导航和公开首页使用的品牌图标',
    publicUrl: '/icon.jpg',
    objectKey: 'static/icon.jpg',
    delivery: 'OBJECT_STORAGE',
  },
  {
    id: 'deck-placeholder',
    title: '卡组占位图',
    description: '卡组列表和空状态使用的公共占位图',
    publicUrl: '/deck.png',
    objectKey: 'static/deck.png',
    delivery: 'OBJECT_STORAGE',
  },
  {
    id: 'first-ranked-season-badge',
    title: '首届排位徽章',
    description: '历史排位活动使用的静态徽章',
    publicUrl: '/badges/first-ranked-season.png',
    objectKey: null,
    delivery: 'FRONTEND',
  },
  {
    id: 'product-magical-treat',
    title: '官方商品 · Magical Treat',
    description: '公开首页商品展示图',
    publicUrl: '/images/official-products/magical-treat.webp',
    objectKey: null,
    delivery: 'FRONTEND',
  },
  {
    id: 'product-sunshine-binder',
    title: '官方商品 · Sunshine Binder',
    description: '公开首页商品展示图',
    publicUrl: '/images/official-products/sunshine-binder.webp',
    objectKey: null,
    delivery: 'FRONTEND',
  },
  {
    id: 'product-lovelive-duo',
    title: '官方商品 · LoveLive Duo',
    description: '公开首页商品展示图',
    publicUrl: '/images/official-products/lovelive-duo.webp',
    objectKey: null,
    delivery: 'FRONTEND',
  },
  {
    id: 'product-nijigasaki-cheer',
    title: '官方商品 · Nijigasaki Cheer',
    description: '公开首页商品展示图',
    publicUrl: '/images/official-products/nijigasaki-cheer.webp',
    objectKey: null,
    delivery: 'FRONTEND',
  },
  {
    id: 'product-mellow-moment',
    title: '官方商品 · Mellow Moment',
    description: '公开首页商品展示图',
    publicUrl: '/images/official-products/mellow-moment.webp',
    objectKey: null,
    delivery: 'FRONTEND',
  },
] as const;
