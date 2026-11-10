# Kadr

A private video editor for phones that runs entirely in the browser (PWA). Your media never leaves the device.

**Live:** https://timofeys22.github.io/Kadr/

- Multi-track timeline: trim, split, speed and speed curves, keyframes, masks, crop, chroma key, filters, transitions, text and stickers
- On-device AI: auto captions (Whisper + Silero VAD), edit by text, noise reduction (RNNoise), background removal and auto reframe (MediaPipe), pause removal, beat detection
- Export MP4 (H.264/AAC) up to 4K with WebCodecs; the preview and the export share one render path
- Templates, sound effects, project backups (`.kadr`), English and Russian UI

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (add -- --host to open it on a phone in the same Wi-Fi)
npm run check      # typecheck + unit tests
npm run build      # production build in dist/
npm run fixtures   # test media for the e2e checks (ffmpeg; macOS `say` for speech)
```

Architecture, decisions and status: `docs/02-architecture-and-plan.md`. Market and feature research: `docs/01-market-and-features.md`, `reports/`.
Every push to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Roll back the site

```bash
node scripts/rollback.mjs 1.8.1        # says which deploy of 1.8.1 it would put back
node scripts/rollback.mjs 1.8.1 --go   # puts that site back on the live address (a deploy)
```

The earlier deploy's site goes back as it was, without a build, in a few minutes (`.github/workflows/rollback.yml`); the files the live site serves stay next to it, so tabs still open on the newer version keep working. Sites are kept 30 days; for an older version, `git revert` and push. The next push to `main` deploys again.
