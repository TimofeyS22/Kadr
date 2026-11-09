#!/bin/sh
# The check before asking to publish (audit V-254, docs/16 §9). Unit tests say little about export, sound, saving and the
# screens, so this also runs what breaks for people, on both engines, on a build of its own (shared test-results and
# ports stay free for other sessions). Green here is not L5: it says nothing about a real phone.
#   npm run gate
set -e
cd "$(dirname "$0")/.."
PORT=${GATE_PORT:-4491}
OUT=$(mktemp -d "${TMPDIR:-/tmp}/kadr-gate.XXXXXX")
trap 'kill "$SERVER" 2>/dev/null || true; rm -rf "$OUT"' EXIT

npm run lint
npm run check
[ -f fixtures/avsync_long.mp4 ] && [ -f fixtures/fps60.mp4 ] || npm run fixtures
node scripts/copy-assets.mjs
npx vite build --outDir "$OUT/dist" --emptyOutDir --logLevel warn
npx vite preview --outDir "$OUT/dist" --port "$PORT" --strictPort --host 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
i=0
until curl -sf "http://127.0.0.1:$PORT/" >/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo "gate: the build is not being served" >&2; exit 1; }
  sleep 1
done
E2E_URL="http://127.0.0.1:$PORT/" npx playwright test --project=iphone-webkit --project=android-chromium --output="$OUT/results" --reporter=line \
  e2e/qa-smoke.spec.ts e2e/qa-av-sync.spec.ts e2e/qa-share-save.spec.ts e2e/qa-privacy-canary.spec.ts \
  e2e/qa-frames-60fps.spec.ts e2e/qa-faces-video.spec.ts e2e/qa-safari-storage.spec.ts e2e/qa-budgets.spec.ts
echo "gate: green on Mac engines. A real phone is still a separate check (docs/16 §1)."
