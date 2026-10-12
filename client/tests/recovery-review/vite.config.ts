import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
const repo = path.resolve(import.meta.dirname, '../../..');
// Optional, existing local art cache; never downloads or modifies card data.
const artRoot =
  process.env.RECOVERY_REVIEW_ART_DIR ?? path.resolve(repo, '../references/llocg_db/img/cards_cn');
const art = new Map([
  ['PL!N-bp5-014-N', 'PL!N-bp5-014-N.png'],
  ['PL!N-sd1-028-SD', 'PL!N-SD01-028.png'],
  ['PL!HS-pb1-020-N', 'PL!HS-pb1-020-N.png'],
  ['PL!HS-sd1-012-SD', 'PL!HS-sd1-012-SD.png'],
  ['PL!HS-bp2-022-L', 'PL!HS-bp2-022-L.png'],
]);
export default defineConfig({
  root: import.meta.dirname,
  define: {
    __APP_VERSION__: JSON.stringify('recovery-review'),
    __APP_BUILD_ID__: JSON.stringify('recovery-review'),
  },
  plugins: [
    tailwindcss(),
    {
      name: 'local-recovery-review-assets',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = decodeURIComponent((req.url ?? '').split('?')[0]);
          const code = /^\/images\/(?:medium|thumb|large)\/(.+)\.webp$/.exec(url)?.[1];
          const filename = code && art.get(code);
          const file = filename
            ? path.join(artRoot, filename)
            : url === '/images/static/deck.png'
              ? path.join(repo, 'assets/deck.png')
              : url.includes('/back.') || code === 'ENERGY'
                ? path.join(repo, 'assets/back.jpg')
                : null;
          if (file && existsSync(file)) {
            res.setHeader('Content-Type', file.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
            createReadStream(file).pipe(res);
            return;
          }
          if (url.startsWith('/api/')) {
            res.statusCode = 404;
            res.end('{}');
            return;
          }
          next();
        });
      },
    },
  ],
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.join(repo, 'client/src'),
      '@game': path.join(repo, 'src'),
      react: path.join(repo, 'client/node_modules/react'),
      'react-dom': path.join(repo, 'client/node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1', port: 5186, strictPort: true, fs: { allow: [repo] } },
});
