import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import rows from './cards.json';

const root = import.meta.dirname;
const repo = path.resolve(root, '../../..');
const assets = new Map([
  ...rows.map((row) => [
    '/images/large/' + row.cardCode + '.webp',
    path.join(
      root,
      'images',
      row.cardCode +
        (fs.existsSync(path.join(root, 'images', row.cardCode + '.png')) ? '.png' : '.webp')
    ),
  ]),
  ['/back.jpg', path.join(repo, 'assets/back.jpg')],
  ['/deck.png', path.join(repo, 'assets/deck.png')],
]);

export default defineConfig({
  root,
  plugins: [
    tailwindcss(),
    {
      name: 'isolated-mirai-preview',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://127.0.0.1');
          // The fixture uses an in-memory GameSession, with no account or backend access.
          if (url.pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            res.end('{}');
            return;
          }
          const file = assets.get(decodeURIComponent(url.pathname));
          if (!file) return next();
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            res.end('Missing preview image');
            return;
          }
          const ext = path.extname(file);
          res.setHeader(
            'Content-Type',
            ext === '.webp' ? 'image/webp' : ext === '.jpg' ? 'image/jpeg' : 'image/png'
          );
          fs.createReadStream(file).pipe(res);
        });
      },
    },
  ],
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.join(repo, 'client/src'),
      '@game': path.join(repo, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 5193,
    strictPort: true,
    fs: { allow: [repo] },
  },
});
