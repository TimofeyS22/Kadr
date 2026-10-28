/// <reference types="vitest/config" />
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_TITLE, DEFAULT_SITE, appMeta, buildSite } from './seo/render.ts';

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

// public/ort exists only for the dev server; the production bundle ships its own hashed copy of the WASM. The
// asyncify ONNX Runtime (27 MB) is the build transformers.js would pick; the speech worker loads the plain one
// (asr.worker.ts), so it is never requested and stays out of the site (every deploy keeps old files, docs/12).
let outDir = 'dist';
const dropUnusedOrt: Plugin = {
  name: 'kadr-drop-unused-ort',
  apply: 'build',
  configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
  closeBundle() {
    rmSync(join(outDir, 'ort'), { recursive: true, force: true });
    if (!existsSync(join(outDir, 'assets'))) return;
    for (const f of readdirSync(join(outDir, 'assets'), { withFileTypes: true })) {
      if (f.isFile() && /^ort-wasm-simd-threaded\.asyncify-.*\.wasm$/.test(f.name)) rmSync(join(outDir, 'assets', f.name));
    }
  },
};

// Task pages, sitemap and robots.txt (docs/08 C) next to the app, plus the app's own description and Open Graph.
const site = process.env.KADR_SITE ?? DEFAULT_SITE;
const taskPages: Plugin = {
  name: 'kadr-task-pages',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<title>Kadr</title>', `<title>${APP_TITLE}</title>\n    ${appMeta(site)}`),
  generateBundle() {
    for (const [fileName, source] of Object.entries(buildSite(site))) this.emitFile({ type: 'asset', fileName, source });
  },
};

/** The app version shown in the home footer: package.json is the one place it is set. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // GitHub Pages serves the app from /<repo>/; CI sets KADR_BASE=/Kadr/.
  base: process.env.KADR_BASE ?? '/',
  // A chunk named after a dot-folder (@soundtouchjs/core's "dist" → ".dist-*.js") is skipped by the precache glob:
  // voice effects and pitch-kept speed then fail offline. Chunk names never start with a dot.
  build: { rollupOptions: { output: { chunkFileNames: (c) => `assets/${c.name.replace(/^\.+/, '') || 'chunk'}-[hash].js` } } },
  plugins: [
    react(),
    e2eUpload,
    dropUnusedOrt,
    taskPages,
    VitePWA({
      registerType: 'prompt', // the app decides when a new version takes over (src/main.tsx)
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
        // Android: "Share → Kadr" from the gallery (installed PWA). Handled by public/share-target.js (docs/08 B).
        share_target: {
          action: 'share-target', method: 'POST', enctype: 'multipart/form-data',
          params: { files: [{ name: 'media', accept: ['video/*', 'image/*', 'audio/*'] }] },
        },
      },
      workbox: {
        importScripts: ['share-target.js'],
        globPatterns: ['**/*.{js,css,html,svg}', '**/inter-*.woff2'],
        // On-device AI (speech model runtime, noise reduction) is large: cache it on first use instead of up front.
        globIgnores: ['**/rnnoise-*.js', '**/asr.worker-*.js', '**/vision_bundle-*.js', 'mediapipe/**', 'models/**', 'ru/**', 'en/**'],
        // Task pages are plain pages from the network, never the app shell.
        navigateFallbackDenylist: [/\/(ru|en)\//],
        maximumFileSizeToCacheInBytes: 4_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(mediapipe|models)\//.test(url.pathname) || /\/assets\/(rnnoise|asr\.worker|vision_bundle|ort-wasm)[-.]/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'kadr-ai', expiration: { maxEntries: 32 } }, // two generations of the speech runtime fit
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
  // Builds with VITE_MODEL_HOST=/hf/ (simulator and device tests, asr.worker.ts) fetch models from their own origin;
  // the preview server relays to Hugging Face and follows its redirects to the file CDN itself.
  preview: { proxy: { '/hf/': { target: 'https://huggingface.co', changeOrigin: true, followRedirects: true, rewrite: (p) => p.replace(/^\/hf/, '') } } },
  // Pre-bundle lazily imported packages so the dev server doesn't reload the page when they are first used.
  optimizeDeps: { include: ['@huggingface/transformers', '@soundtouchjs/core', '@mediapipe/tasks-vision', '@shiguredo/rnnoise-wasm', 'fflate'] },
  test: { include: ['src/**/*.test.ts', 'seo/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
