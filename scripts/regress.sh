#!/usr/bin/env bash
# Every browser acceptance suite, one after the other.
#   scripts/regress.sh            dev server (each suite starts its own)
#   scripts/regress.sh preview    production build (npm run build first);
#                                 serves dist on :4173 for the run
# Logs: out/regress-<mode>-<suite>.log; summary on stdout.
set -u
cd "$(dirname "$0")/.."
MODE="${1:-dev}"
SUITES="e2e e2e-m3 e2e-m4 e2e-edit e2e-scan e2e-share-print e2e-pages e2e-word"
if [ "$MODE" = preview ]; then
  # vite itself, not npx: killing npx would leave the server running
  node_modules/.bin/vite preview --port 4173 --strictPort > out/preview-server.log 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  sleep 3
  export BASE=http://localhost:4173 SKIP_PDFJS=1
fi
status=0
for s in $SUITES; do
  log="out/regress-$MODE-$s.log"
  timeout 1500 node "scripts/$s.cjs" > "$log" 2>&1
  code=$?
  [ $code -ne 0 ] && status=1
  printf '%-10s exit %s  %s\n' "$s" "$code" "$(grep -E 'checks passed' "$log" | tail -1)"
  grep -E '^FAIL' "$log" | sed 's/^/    /'
done
exit $status
