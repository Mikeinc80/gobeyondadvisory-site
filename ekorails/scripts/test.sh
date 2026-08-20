#!/usr/bin/env bash
# Runs the full test suite.
#
# Suites run SERIALLY and each rebuilds the database from migrations. That is slower than
# running them in parallel, and it is deliberate: a test that passes because of state
# another test left behind is worse than no test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export EKORAILS_ENV_MODE="${EKORAILS_ENV_MODE:-TEST}"
export EKORAILS_LOG_LEVEL="${EKORAILS_LOG_LEVEL:-error}"

echo "==> Building"
npx tsc -p services/api/tsconfig.json

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_SUITES=()

for suite in unit mandatory api; do
  echo
  echo "==> Suite: $suite"
  set +e
  output="$(node --test --test-concurrency=1 "services/api/dist/test/${suite}.test.js" 2>&1)"
  status=$?
  set -e

  pass="$(printf '%s\n' "$output" | grep -E '^# pass ' | awk '{print $3}')"
  fail="$(printf '%s\n' "$output" | grep -E '^# fail ' | awk '{print $3}')"
  TOTAL_PASS=$((TOTAL_PASS + ${pass:-0}))
  TOTAL_FAIL=$((TOTAL_FAIL + ${fail:-0}))

  if [[ "$status" -ne 0 ]]; then
    FAILED_SUITES+=("$suite")
    printf '%s\n' "$output" | grep -B2 -A12 '^    not ok' | head -80
  fi
  echo "    ${pass:-0} passed, ${fail:-0} failed"
done

echo
echo "=============================================="
echo "  Total: ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed"
echo "=============================================="

if [[ ${#FAILED_SUITES[@]} -gt 0 ]]; then
  echo "  FAILED SUITES: ${FAILED_SUITES[*]}"
  exit 1
fi
echo
