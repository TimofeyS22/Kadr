#!/bin/sh
# The full e2e of a commit in GitHub Actions (.github/workflows/e2e.yml) instead of on the Mac (docs/21 §7): both engines
# on macOS runners, 5 machines at once, one worker each, ~80 minutes, and the Mac stays free. Pushes the commit, with
# this checkout's CI files on top (the workflow, its summary script, the arguments), to the branch ci/e2e — never to
# main, nothing is deployed — waits for the run and prints its summary: passed, failed, skipped per project and each
# failed test as file:line. A partial run (files, -g) takes one machine; runs at once share the 5 machines.
#   sh scripts/ci-e2e.sh <ref> [Playwright arguments…]   e.g. sh scripts/ci-e2e.sh main
#                                                             sh scripts/ci-e2e.sh HEAD e2e/editor.spec.ts -g "every video tool"
#   NO_WAIT=1 sh scripts/ci-e2e.sh <ref>                 push and print the run's address only
#   sh scripts/ci-e2e.sh --run <run id>                  wait for a run already started and print its summary
# Exit status: 0 green, 1 red (a test failed or a shard left no report), 2 the run could not be started.
set -eu
cd "$(dirname "$0")/.."
[ $# -ge 1 ] || { sed -n '2,11p' "$0" >&2; exit 2; }
BRANCH=ci/e2e
WORKFLOW=e2e.yml
CI_FILES=".github/workflows/e2e.yml scripts/ci-e2e-summary.mjs"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ci-e2e.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
# gh on this network drops a request now and then (TLS handshake timeout): each question is asked up to five times.
view() { for _ in 1 2 3 4 5; do gh run view "$ID" "$@" 2>/dev/null && return; sleep 10; done; return 1; }

if [ "$1" = --run ]; then
  ID=${2:?run id}
else
  REF=$1; shift
  SHA=$(git rev-parse --verify "$REF^{commit}") || { echo "ci-e2e: no commit $REF" >&2; exit 2; }
  # The commit under test plus this checkout's CI files: the code is the commit's, the machinery today's.
  export GIT_INDEX_FILE="$TMP/index"
  git read-tree "$SHA"
  for f in $CI_FILES; do
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$f"
  done
  if [ $# -gt 0 ]; then
    printf '%s\n' "$@" > "$TMP/args" # one argument per line: -g "two words" stays one argument
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$TMP/args"),.github/ci-e2e-args"
  else
    git rm -q --cached --ignore-unmatch .github/ci-e2e-args
  fi
  TREE=$(git write-tree)
  unset GIT_INDEX_FILE
  COMMIT=$(git commit-tree "$TREE" -p "$SHA" -m "ci: e2e of $SHA${*:+ ($*)}")
  # The same branch every time: GitHub keeps caches (fixtures, models) per branch, so a new name would rebuild them.
  git push -q --force origin "$COMMIT:refs/heads/$BRANCH"
  echo "ci-e2e: $(git log -1 --format='%h %s' "$SHA")"
  echo "ci-e2e: pushed $COMMIT to $BRANCH${*:+, arguments: $*}"
  ID=
  i=0
  while [ -z "$ID" ]; do
    i=$((i + 1))
    [ "$i" -le 40 ] || { echo "ci-e2e: no run of $WORKFLOW for $COMMIT after 2 minutes" >&2; exit 2; }
    sleep 3
    ID=$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --event push --limit 20 --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$COMMIT\") | .databaseId" 2>/dev/null | head -1)
  done
fi
echo "ci-e2e: run $(view --json url --jq .url) (if this shell dies: sh scripts/ci-e2e.sh --run $ID)"
[ -z "${NO_WAIT:-}" ] || exit 0

START=$(date +%s)
ATTEMPT=1
while :; do
  # Not `gh run watch`: it gave up after 20 minutes on a network error while the run went on.
  until [ "$(view --json status --jq .status || true)" = completed ]; do sleep 60; done
  CONCLUSION=$(view --json conclusion --jq .conclusion)
  # GitHub runs short of macOS runners at times and gives a job up ("not acquired … after multiple attempts"): the job
  # ends cancelled inside a failed run. Such jobs get two more attempts; the tests that did run are not run again.
  LOST=$(view --json jobs --jq '[.jobs[] | select(.conclusion == "cancelled")] | length')
  [ "$CONCLUSION" = failure ] && [ "$LOST" -gt 0 ] && [ "$ATTEMPT" -lt 3 ] || break
  ATTEMPT=$((ATTEMPT + 1))
  echo "ci-e2e: $LOST job(s) got no runner; attempt $ATTEMPT"
  gh run rerun "$ID" --failed
  sleep 30
done
echo "ci-e2e: $CONCLUSION after $(( ($(date +%s) - START) / 60 )) min of waiting (attempts: $ATTEMPT)"
for _ in 1 2 3; do gh run download "$ID" -n e2e-summary -D "$TMP/summary" > /dev/null 2>&1 && break; sleep 10; done
if [ -f "$TMP/summary/summary.md" ]; then
  cat "$TMP/summary/summary.md"
  echo
  echo "Traces of failed tests: gh run download $ID -p 'failures-*'   Merged HTML report: gh run download $ID -n e2e-report"
else
  echo "ci-e2e: the run left no summary; jobs:" >&2
  view --json jobs --jq '.jobs[] | "  \(if .conclusion == "" then .status else .conclusion end)  \(.name)"' >&2
fi
[ "$CONCLUSION" = success ]
