#!/usr/bin/env bash
# tools/regtest/wait-ready.sh - block until the upstream regtest
# stack is fully up (G004 / §52). Used by `pnpm test:integration`
# to gate test execution behind a healthy stack.
#
# Usage:
#   bash tools/regtest/wait-ready.sh
#
# Environment:
#   XCHAIN_REGTEST_BASE_URL    Default http://localhost
#   XCHAIN_REGTEST_TIMEOUT_MS  Default 60000

set -euo pipefail

TIMEOUT_MS="${XCHAIN_REGTEST_TIMEOUT_MS:-60000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

start_ms=$(($(date +%s) * 1000))
deadline=$((start_ms + TIMEOUT_MS))

attempt=0
while :; do
    attempt=$((attempt + 1))
    if bash "$SCRIPT_DIR/bootstrap.sh" >/dev/null 2>&1; then
        echo "wait-ready.sh: stack ready after $attempt attempt(s)."
        exit 0
    fi
    now_ms=$(($(date +%s) * 1000))
    if [[ "$now_ms" -ge "$deadline" ]]; then
        echo "wait-ready.sh: stack not ready after $((TIMEOUT_MS / 1000))s - failing." >&2
        bash "$SCRIPT_DIR/bootstrap.sh" >&2 || true
        exit 1
    fi
    sleep 1
done
