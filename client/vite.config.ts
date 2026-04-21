import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { readFileSync } from 'fs';

// 从 package.json 读取版本号
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const appVersion = pkg.version;
const cacheVersion = `v${appVersion}`;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 从根目录 .env 加载 DASHSCOPE_BASE_URL 和 DASHSCOPE_API_KEY
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');

  return {
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    {
      name: 'loveca-version-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: appVersion }, null, 2),
        });
      },
    },
    react(), 
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['back.jpg', 'deck.png', 'icon.jpg'],
      manifest: {
        name: 'Loveca Card Game',
        short_name: 'Loveca',
        description: 'Love Live! 卡牌对战游戏',
        theme_color: '#2d2820',
        background_color: '#1f1a15',
        display: 'standalone',
        icons: [
          {
            src: 'icon.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
          },
        ],
      },
      workbox: {
        cacheId: `loveca-${cacheVersion}`,
        cleanupOutdatedCaches: true,
        // 运行时缓存配置
        runtimeCaching: [
          // Remote card images (Nginx proxy to MinIO)
          {
            urlPattern: /\/images\/(thumb|medium|large)\/.*\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: `remote-card-images-${cacheVersion}`,
              expiration: {
                maxEntries: 1500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Remote static assets (deck.png, back.jpg, etc.)
          {
            urlPattern: /\/images\/static\//,
            handler: 'CacheFirst',
            options: {
              cacheName: `remote-static-assets-${cacheVersion}`,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Local card images (fallback mode)
          {
            urlPattern: /\/card\/.*\.(jpg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: `local-card-images-${cacheVersion}`,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // 能量卡图片缓存
          {
            urlPattern: /\/energy\/.*\.(jpg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: `energy-card-images-${cacheVersion}`,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // 压缩后的图片缓存
          {
            urlPattern: /\/compressed\/.*\.(jpg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: `compressed-card-images-${cacheVersion}`,
              expiration: {
                maxEntries: 1500, // thumb + medium + large
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
        // 预缓存静态资源
        globPatterns: ['**/*.{js,css,html,ico,svg}'],
        // 跳过等待，立即激活新 Service Worker
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  resolve: {
    alias: {
      // 游戏引擎逻辑
      '@game': path.resolve(__dirname, '../src'),
      // 客户端源码
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 允许访问根目录的 assets
  server: {
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api/dashscope': {
        target: rootEnv.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dashscope/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (rootEnv.DASHSCOPE_API_KEY) {
              proxyReq.setHeader('Authorization', `Bearer ${rootEnv.DASHSCOPE_API_KEY}`);
            }
          });
        },
      },
      '/api': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://localhost:9000/loveca-cards',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/images/, ''),
      },
    },
  },
  preview: {
    allowedHosts: ['loveca.aiphys.cn', 'loveca.lovelivefun.xyz'],
    // 如果你还希望通过 IP 或其他域名访问，也可以加：
    // allowedHosts: ['loveca.aiphys.cn', '192.168.1.100', 'your-other-domain.com']
  },
  // 配置公共资源目录
  publicDir: '../assets',
  // 优化：不要把游戏引擎打包成外部依赖
  optimizeDeps: {
    include: [],
  },
  };
});
