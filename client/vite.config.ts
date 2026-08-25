import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import path from 'path';
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';

// 产品版本由仓库根目录 VERSION 维护，并通过 version:check 与 package 版本保持一致。
const appVersion = readFileSync(path.resolve(__dirname, '../VERSION'), 'utf-8').trim();
const cacheVersion = `v${appVersion}`;
const resolveGitCommitSha = (): string | undefined => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};
const appBuildId =
  process.env.VITE_APP_BUILD_ID?.trim() ||
  process.env.GIT_COMMIT_SHA?.trim() ||
  resolveGitCommitSha() ||
  `${appVersion}-${new Date().toISOString()}`;
const localImagesDir = path.resolve(__dirname, '../assets/images');

function localImagesFallbackPlugin(): Plugin {
  return {
    name: 'loveca-local-images-fallback',
    configureServer(server) {
      const serveLocalImage: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url?.startsWith('/images/')) {
          next();
          return;
        }

        const pathname = new URL(req.url, 'http://localhost').pathname;
        const relativePath = decodeURIComponent(pathname.replace(/^\/images\//, ''));
        const normalizedPath = path.normalize(relativePath);

        if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
          next();
          return;
        }

        const filePath = path.join(localImagesDir, normalizedPath);
        if (!filePath.startsWith(`${localImagesDir}${path.sep}`)) {
          next();
          return;
        }

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader(
          'Content-Type',
          filePath.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'
        );
        createReadStream(filePath).pipe(res);
      };

      server.middlewares.use(serveLocalImage);
    },
  };
}

function localPublicSiteStatusPlugin(snapshotPath: string | undefined): Plugin {
  return {
    name: 'loveca-local-public-site-status',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/site-status.json') {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        if (snapshotPath && existsSync(snapshotPath)) {
          res.end(readFileSync(snapshotPath, 'utf8'));
          return;
        }
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            availability: 'OPEN',
            generatedAt: new Date().toISOString(),
            maintenance: null,
          })
        );
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 从根目录部署环境读取本地对象存储开发代理配置。
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const minioUseSsl = process.env.MINIO_USE_SSL ?? rootEnv.MINIO_USE_SSL;
  const minioProtocol = minioUseSsl === 'true' ? 'https' : 'http';
  const minioEndpoint = process.env.MINIO_ENDPOINT || rootEnv.MINIO_ENDPOINT || 'localhost';
  const minioPort = process.env.MINIO_PORT || rootEnv.MINIO_PORT || '9000';
  const minioBucket = process.env.MINIO_BUCKET || rootEnv.MINIO_BUCKET || 'loveca-cards';
  const minioTarget = `${minioProtocol}://${minioEndpoint}:${minioPort}/${minioBucket}`;
  const configuredPublicSiteStatusSnapshotPath =
    process.env.PUBLIC_SITE_STATUS_SNAPSHOT_PATH || rootEnv.PUBLIC_SITE_STATUS_SNAPSHOT_PATH;
  const publicSiteStatusSnapshotPath = configuredPublicSiteStatusSnapshotPath
    ? path.isAbsolute(configuredPublicSiteStatusSnapshotPath)
      ? configuredPublicSiteStatusSnapshotPath
      : path.resolve(__dirname, '..', configuredPublicSiteStatusSnapshotPath)
    : undefined;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_ID__: JSON.stringify(appBuildId),
    },
    plugins: [
      {
        name: 'loveca-version-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version: appVersion, buildId: appBuildId }, null, 2),
          });
        },
      },
      localImagesFallbackPlugin(),
      localPublicSiteStatusPlugin(publicSiteStatusSnapshotPath),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [
          'back.jpg',
          'deck.png',
          'icon.jpg',
          'pwa/icon-192.png',
          'pwa/icon-512.png',
          'pwa/icon-maskable-192.png',
          'pwa/icon-maskable-512.png',
        ],
        manifest: {
          name: 'Loveca Card Game',
          short_name: 'Loveca',
          description: 'Love Live! 卡牌对战游戏',
          id: '/',
          start_url: '/',
          scope: '/',
          lang: 'zh-CN',
          theme_color: '#1d1321',
          background_color: '#1d1321',
          display: 'standalone',
          orientation: 'any',
          categories: ['games', 'entertainment'],
          icons: [
            {
              src: 'pwa/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa/icon-maskable-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'pwa/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cacheId: `loveca-${cacheVersion}`,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
            // Content-addressed match emotes
            {
              urlPattern: /\/images\/emotes\/[0-9a-f]{64}\.webp$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'match-emotes-content-addressed',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 365 * 24 * 60 * 60,
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
        '/api': {
          target: 'http://localhost:3007',
          changeOrigin: true,
        },
        '/images': {
          target: minioTarget,
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
