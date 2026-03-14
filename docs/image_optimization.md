# 卡牌图片优化方案

> 版本: 2.0.0  
> 创建日期: 2025-01-05  
> 最后更新: 2026-03-15

## 概述

本方案使用 MinIO 对象存储存储卡牌图片，解决带宽问题并提供前端缓存支持。通过图片压缩和多尺寸版本，显著提升加载速度。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│  原始图片 (assets/card/*.jpg)                                       │
│  ~200-300KB/张, 总计 115MB                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  压缩脚本 (src/scripts/compress-images.ts)                          │
│  使用 Sharp 库, 输出 WebP 格式, 生成多尺寸版本                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  压缩后图片 (assets/compressed/)                                     │
│  ├── thumb/   (~8KB/张)   - 列表预览                                │
│  ├── medium/  (~30KB/张)  - 游戏中显示                              │
│  └── large/   (~80KB/张)  - 详情查看                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MinIO Storage (loveca-cards bucket)                                │
│  上传脚本: src/scripts/upload-to-minio.ts                           │
│  Nginx 反向代理, 支持公开访问                                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  前端 imageService (client/src/lib/imageService.ts)                 │
│  - URL 生成                                                          │
│  - 图片预加载                                                        │
│  - 响应式图片支持                                                    │
│  - 本地静态文件降级                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `src/scripts/compress-images.ts` | 图片压缩脚本 |
| `src/scripts/upload-to-minio.ts` | 上传到 MinIO Storage |
| `client/src/lib/imageService.ts` | 前端图片服务 |
| `docs/minio-requirements.md` | MinIO 部署配置文档 |

---

## 使用指南

### 1. 压缩图片

```bash
# 安装依赖 (如果未安装)
pnpm install

# 运行压缩脚本
npx tsx src/scripts/compress-images.ts
```

**输出示例：**
```
🎴 卡牌图片压缩工具

📂 创建目录: assets/compressed
📂 创建目录: assets/compressed/thumb
📂 创建目录: assets/compressed/medium
📂 创建目录: assets/compressed/large
📁 找到 150 张图片待处理

⏳ 处理中... 150/150 (100%)

✅ 压缩完成!

📊 压缩统计:

| 尺寸 | 数量 | 原始大小 | 压缩后 | 节省 |
|------|------|----------|--------|------|
| thumb  | 150  | 115MB | 1.2MB | 99% |
| medium | 150  | 115MB | 4.5MB | 96% |
| large  | 150  | 115MB | 12MB  | 90% |

💾 总计: 345MB → 17.7MB

📋 上传清单已生成: assets/compressed/upload-manifest.json
```

### 2. 配置 MinIO Storage

详见 `docs/minio-requirements.md` 文档。

主要步骤：
1. 在独立服务器上部署 MinIO (Docker)
2. 创建 `loveca-cards` bucket
3. 设置公开读取策略
4. 记录连接信息（endpoint、access key、secret key）

### 3. 上传图片

```bash
# 设置环境变量并运行上传脚本
MINIO_ENDPOINT=10.0.0.2 \
MINIO_ACCESS_KEY=xxx \
MINIO_SECRET_KEY=xxx \
npx tsx src/scripts/upload-to-minio.ts
```

### 4. 前端配置

确保 `client/.env.local` 或 `client/.env` 包含：

```env
VITE_API_BASE_URL=https://loveca.example.com
```

---

## 图片访问 URL

### MinIO Storage URL 格式

通过 Nginx 反向代理访问：

```
{BASE_URL}/images/{size}/{cardCode}.webp
```

**示例：**
- 缩略图: `https://loveca.example.com/images/thumb/PL-sd1-001.webp`
- 中等: `https://loveca.example.com/images/medium/PL-sd1-001.webp`
- 大图: `https://loveca.example.com/images/large/PL-sd1-001.webp`

### 前端 API 使用

```typescript
import { getCardImageUrl, preloadCardImages, getCardSrcSet } from '@/lib/imageService';

// 获取图片 URL
const url = getCardImageUrl('PL-sd1-001', 'medium');

// 预加载手牌图片
await preloadCardImages(['PL-sd1-001', 'PL-sd1-002'], 'medium');

// 响应式图片
<img
  src={getCardImageUrl(cardCode, 'medium')}
  srcSet={getCardSrcSet(cardCode)}
  sizes="(max-width: 640px) 100px, (max-width: 1024px) 150px, 200px"
  loading="lazy"
/>
```

---

## 降级策略

当 API 未配置或不可用时，系统自动降级到本地静态文件：

```typescript
// imageService.ts 内部逻辑
if (API_BASE_URL) {
  return `${API_BASE_URL}/images/${size}/${cardCode}.webp`;
}
// 降级到本地
return `/card/${cardCode}.jpg`;
```

---

## 图片尺寸规格

| 尺寸名 | 宽度 | 质量 | 用途 | 预计大小 |
|--------|------|------|------|----------|
| `thumb` | 100px | 75% | 列表/网格预览 | ~8KB |
| `medium` | 300px | 80% | 游戏中卡牌显示 | ~30KB |
| `large` | 600px | 85% | 详情查看/弹窗 | ~80KB |

---

## 缓存策略

### 浏览器缓存

Nginx 为图片设置 `Cache-Control` 头，图片会被浏览器缓存 30 天。

### 前端预加载缓存

`imageService.ts` 提供内存级预加载缓存：

```typescript
// 预加载后不会重复请求
await preloadCardImages(['PL-sd1-001'], 'medium');
```

### Service Worker 缓存 (已实现)

项目已配置 vite-plugin-pwa 实现 Service Worker 缓存，支持离线访问图片资源。

**缓存策略配置 (client/vite.config.ts):**

| 缓存名 | URL 匹配规则 | 策略 | 过期时间 | 最大条目 |
|--------|-------------|------|----------|----------|
| `remote-card-images` | /images/*.webp | CacheFirst | 30 天 | 500 |
| `local-card-images` | 本地 /card/*.jpg | CacheFirst | 30 天 | 500 |
| `energy-card-images` | 本地 /energy/*.png | CacheFirst | 30 天 | 50 |
| `compressed-card-images` | 压缩后图片 | CacheFirst | 30 天 | 1500 |
| `static-assets` | /images/static/* | CacheFirst | 30 天 | 50 |

**配置代码示例:**

```typescript
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/images\/(thumb|medium|large)\/.*\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'remote-card-images',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // ... 其他缓存规则
        ],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
});
```

---

## 效果对比

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 单张图片大小 | 200-300KB | 30KB (medium) | ~90% |
| 首屏加载 (20张) | ~5MB | ~0.6MB | ~88% |
| Nginx 代理加速 | 无 | 本地服务器 | ✅ |
| 缓存支持 | 浏览器默认 | 多级缓存 | ✅ |
| 响应式图片 | 无 | 支持 srcSet | ✅ |

---

## 注意事项

1. **首次压缩**: 压缩 150 张图片约需 1-2 分钟
2. **上传带宽**: 上传约 18MB 数据，耗时取决于网络
3. **存储空间**: MinIO 服务器需预留足够磁盘空间
4. **环境变量**: MinIO 密钥不要提交到代码仓库

---

## 相关文档

- `docs/minio-requirements.md` — MinIO 独立服务器部署方案
- `docs/self-hosted-migration.md` — 自托管迁移完整方案

---

*文档最后更新: 2026-03-15*