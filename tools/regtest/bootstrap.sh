#!/usr/bin/env bash
# tools/regtest/bootstrap.sh — probe the upstream regtest stack
# (G004 / §52). Exits 0 when every required service responds; exits
# non-zero with a structured diagnostic when one is missing.
#
# Usage:
#   bash tools/regtest/bootstrap.sh
#
# Environment:
#   XCHAIN_REGTEST_BASE_URL    Default http://localhost
#   XCHAIN_REGTEST_VERBOSE     Set to log every probe

set -euo pipefail

BASE="${XCHAIN_REGTEST_BASE_URL:-http://localhost}"
VERBOSE="${XCHAIN_REGTEST_VERBOSE:-}"

# (label, url) pairs the wallet's tests rely on.
SERVICES=(
    "bitcoin-regtest|${BASE}:18443"
    "dogecoin-regtest|${BASE}:18332"
    "litecoin-regtest|${BASE}:18444"
    "xchain-decoder|${BASE}:8101/api/decoder/health"
    "xchain-indexer|${BASE}:8102/api/indexer/health"
    "xchain-explorer|${BASE}:18000/api/explorer/health"
    "xchain-hub|${BASE}:18001/health"
)

if ! command -v curl >/dev/null 2>&1; then
    echo "bootstrap.sh: curl not found in PATH" >&2
    exit 2
fi

failures=0
for entry in "${SERVICES[@]}"; do
    label="${entry%%|*}"
    url="${entry##*|}"
    if [[ -n "$VERBOSE" ]]; then
        echo "bootstrap.sh: probing $label at $url ..." >&2
    fi
    # JSON-RPC nodes (bitcoin / dogecoin / litecoin regtest) don't
    # serve plain GET — a connection-refused exit is the failure
    # signal we care about. Use --max-time to bound each probe.
    if curl -fsS --max-time 3 -o /dev/null "$url" 2>/dev/null \
        || curl -sS --max-time 3 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null \
            | grep -qE '^(200|401|404|405)$'; then
        printf '  \xe2\x9c\x93  %-22s %s\n' "$label" "$url"
    else
        printf '  \xe2\x9c\x97  %-22s %s\n' "$label" "$url" >&2
        failures=$((failures + 1))
    fi
done

if [[ "$failures" -gt 0 ]]; then
    cat >&2 <<EOF

bootstrap.sh: $failures service(s) not responding.

The wallet's regtest tests need the upstream platform stack running.
Bring it up:

  cd REDACTED-LOCAL-PATH
  ./xchain-node.sh start

Then re-run this script. If you've changed default ports, override
XCHAIN_REGTEST_BASE_URL=http://your-host:port.
EOF
    exit 1
fi

echo "bootstrap.sh: all regtest services responding."
