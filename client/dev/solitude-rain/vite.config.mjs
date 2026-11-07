import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
const root = import.meta.dirname,
  repo = path.resolve(root, '../../..');
export default defineConfig({
  root,
  cacheDir: path.join(repo, 'client/node_modules/.vite-solitude-rain'),
  plugins: [
    tailwindcss(),
    {
      name: 'isolated-solitude-rain',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://127.0.0.1');
          // Memory-only GameSession. The review page cannot contact an account or backend API.
          if (url.pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            res.end('{}');
            return;
          }
          if (!['/back.jpg', '/deck.png'].includes(url.pathname)) return next();
          res.setHeader('Content-Type', url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
          fs.createReadStream(path.join(repo, 'assets', path.basename(url.pathname))).pipe(res);
        });
      },
    },
  ],
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': path.join(repo, 'client/src'), '@game': path.join(repo, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1', port: 5194, strictPort: true, fs: { allow: [repo] } },
});
