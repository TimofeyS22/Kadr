/// <reference types="vitest/config" />
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Dev-only e2e hook: lets browser tests save an exported file into fixtures/ for ffprobe checks.
const e2eUpload: Plugin = {
  name: 'kadr-e2e-upload',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__e2e/upload', (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const name = String(req.headers['x-file-name'] ?? 'export.bin').replace(/[^\w.-]/g, '');
        writeFileSync(join(import.meta.dirname, 'fixtures', name), Buffer.concat(chunks));
        res.end('ok');
      });
    });
  },
};

// public/ort exists only for the dev server; the production bundle ships its own hashed copy of the WASM.
const dropDevOrt: Plugin = {
  name: 'kadr-drop-dev-ort',
  apply: 'build',
  closeBundle() { rmSync(join(import.meta.dirname, 'dist', 'ort'), { recursive: true, force: true }); },
};

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; CI sets KADR_BASE=/Kadr/.
  base: process.env.KADR_BASE ?? '/',
  plugins: [
    react(),
    e2eUpload,
    dropDevOrt,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Kadr — video editor',
        short_name: 'Kadr',
        description: 'Private video editor that runs entirely on your device.',
        theme_color: '#161616',
        background_color: '#161616',
        display: 'standalone',
        orientation: 'portrait',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}', '**/inter-*.woff2'],
        // On-device AI (speech model runtime, noise reduction) is large: cache it on first use instead of up front.
        globIgnores: ['**/rnnoise-*.js', '**/asr.worker-*.js', '**/vision_bundle-*.js', 'mediapipe/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 4_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(mediapipe|models)\//.test(url.pathname) || /\/assets\/(rnnoise|asr\.worker|vision_bundle|ort-wasm)[-.]/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'kadr-ai', expiration: { maxEntries: 16 } },
          },
          {
            // Music library: the list refreshes in the background; tracks are kept once heard or added. Range
            // requests (audio preview streaming) go to the network: a cached full response can't answer them.
            urlPattern: ({ url }) => /\/music\/music\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'kadr-music-list' },
          },
          {
            urlPattern: ({ url, request }) => /\/music\/tracks\//.test(url.pathname) && !request.headers.has('range'),
            handler: 'CacheFirst',
            options: { cacheName: 'kadr-music', expiration: { maxEntries: 60 } },
          },
          {
            // Text fonts download when first used and then work offline.
            urlPattern: ({ url }) => /\.woff2$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'kadr-fonts', expiration: { maxEntries: 120 } },
          },
        ],
      },
    }),
  ],
  // Pre-bundle lazily imported packages so the dev server doesn't reload the page when they are first used.
  optimizeDeps: { include: ['@huggingface/transformers', '@soundtouchjs/core', '@mediapipe/tasks-vision', '@shiguredo/rnnoise-wasm', 'fflate'] },
  test: { include: ['src/**/*.test.ts'] },
});
