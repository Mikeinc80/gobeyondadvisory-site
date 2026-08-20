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

# The API suite gives each client a distinct X-Forwarded-For so that one test's rate-limit
# assertions do not starve every test after it. That header is believed only from a
# configured proxy — so the loopback is declared as one here, which also exercises the
# trusted-proxy path rather than leaving it untested.
export EKORAILS_TRUSTED_PROXIES="127.0.0.1,::ffff:127.0.0.1,::1"

echo "==> Building"
npx tsc -p services/api/tsconfig.json

# The web client has no build step, so nothing else would notice a renamed export or a
# menu item pointing at a route that no longer exists. This does that job.
echo "==> Checking the web client"
node scripts/check-web.mjs

echo "==> Checking user-facing claims"
node scripts/lint-claims.mjs

# The documents that describe mechanism are generated from the definitions the software
# uses. This fails the build when a definition has changed and the documents have not,
# rather than leaving a role matrix that is quietly wrong.
echo "==> Checking generated documents"
node scripts/generate-docs.mjs --check

# A setting documented in .env.example that nothing reads is worse than a missing one:
# somebody will set it and believe it took effect.
echo "==> Checking environment configuration"
node scripts/check-env.mjs

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
