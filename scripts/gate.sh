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
# Node itself, not npx: `kill $SERVER` must stop the server, or it keeps the port and the next run tests this build.
node node_modules/vite/bin/vite.js preview --outDir "$OUT/dist" --port "$PORT" --strictPort --host 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
i=0
until curl -sf "http://127.0.0.1:$PORT/" >/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo "gate: the build is not being served" >&2; exit 1; }
  sleep 1
done
# The port answers with this build, not another session's server (a run that measured someone else's build said nothing).
want=$(grep -o 'assets/index-[^"]*\.js' "$OUT/dist/index.html" | head -1)
got=$(curl -s "http://127.0.0.1:$PORT/" | grep -o 'assets/index-[^"]*\.js' | head -1)
[ "$got" = "$want" ] || { echo "gate: port $PORT serves $got, not this build's $want" >&2; exit 1; }
E2E_URL="http://127.0.0.1:$PORT/" npx playwright test --project=iphone-webkit --project=android-chromium --output="$OUT/results" --reporter=line \
  e2e/qa-smoke.spec.ts e2e/qa-av-sync.spec.ts e2e/qa-share-save.spec.ts e2e/qa-privacy-canary.spec.ts \
  e2e/qa-frames-60fps.spec.ts e2e/qa-faces-video.spec.ts e2e/qa-safari-storage.spec.ts e2e/qa-budgets.spec.ts e2e/qa-look-tiles.spec.ts \
  e2e/qa-overlay-speed.spec.ts
# The speed budgets of CLAUDE.md §5 (e2e/qa-speed.spec.ts) mean something only on this Mac in a quiet minute: the cloud's
# machine is three times slower, and at load 40 a red said nothing on old builds and new alike (docs/21 §7).
if [ "$(uname)" = Darwin ]; then
  i=0
  until sysctl -n vm.loadavg | awk '{ exit !($2 < 4) }'; do
    i=$((i + 1))
    [ "$i" -lt 120 ] || { echo "gate: load $(sysctl -n vm.loadavg) stayed at 4 or more for 10 min: the speed budgets were not measured; run the gate again in a quiet minute" >&2; exit 1; }
    sleep 5
  done
  echo "gate: speed budgets at $(uptime)"
  SPEED=1 E2E_URL="http://127.0.0.1:$PORT/" npx playwright test --project=speed-webkit --project=speed-chromium --workers=1 --output="$OUT/speed" --reporter=line e2e/qa-speed.spec.ts
else
  echo "gate: the speed budgets (SPEED=1, e2e/qa-speed.spec.ts) are measured on the Mac in a quiet minute; not here"
fi
echo "gate: green on Mac engines. A real phone is still a separate check (docs/16 §1)."
