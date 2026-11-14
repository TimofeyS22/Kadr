#!/bin/sh
# Runs a command in one of a few shared slots on this Mac (docs/21 §7). Several sessions run browsers at once on an
# 8-core, 8 GB machine: at load 45-55 a camera gave no frames, timers stalled and tests timed out on old and new builds
# alike (2026-11-14), so a red said nothing. Each session waits here for a free slot instead.
#   sh scripts/e2e-slot.sh npx playwright test --workers=1 ...
#   E2E_SLOTS=1 sh scripts/e2e-slot.sh npm run check
# The slots live in the repository's shared .git, so every worktree sees the same ones; a slot whose holder died is freed.
SLOTS=${E2E_SLOTS:-2}
ROOT="$(git rev-parse --git-common-dir)/e2e-slots"
mkdir -p "$ROOT"
waited=0
while :; do
  i=1
  while [ "$i" -le "$SLOTS" ]; do
    d="$ROOT/$i"
    if mkdir "$d" 2>/dev/null; then
      echo "$$" > "$d/pid"
      trap 'rm -rf "$d"' EXIT INT TERM
      [ "$waited" -gt 0 ] && echo "e2e-slot: slot $i after ${waited}s" >&2
      "$@"
      exit $?
    fi
    holder=$(cat "$d/pid" 2>/dev/null)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then rm -rf "$d"; continue; fi
    i=$((i + 1))
  done
  sleep 5
  waited=$((waited + 5))
done
