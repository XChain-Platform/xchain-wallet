#!/usr/bin/env bash
#*********************************************************************
#
# Copyright © 2025-2026 Dankest, LLC
# Based on XChain Platform by Dankest, LLC - https://dankest.llc
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# This file is part of XChain Platform. Licensed under the GNU Affero
# General Public License v3.0 or later; see LICENSE.md. A commercial
# license (without AGPL source-disclosure terms) is available -
# contact legal@dankest.llc.
#
#*********************************************************************

# tools/regtest/bootstrap.sh - probe the upstream regtest stack
# (G004 / §52). Exits 0 when every service the wallet's SDK talks to
# responds AND the explorer is actually wired to its decoders; exits
# non-zero with a structured diagnostic when one is missing.
#
# The probed set is exactly the wallet regtest chain descriptors
# (packages/core/src/registry/descriptors/*.js): one shared explorer,
# one encoder per chain, one shared hub. The wallet never talks to the
# nodes/decoders/indexers directly (they sit upstream of the explorer),
# so those are not probed here; the explorer's own status endpoint is
# what surfaces decoder wiring, and this script asserts it.
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

# (label, url) pairs the wallet's tests rely on. Ports mirror the
# regtest chain descriptors: explorer 18080, encoders BTC 3023 /
# DOGE 3123 / LTC 3223, hub 10000. The explorer entry points at a
# per-chain status endpoint (there is no generic /health) and is
# additionally content-checked below.
EXPLORER_STATUS_URL="${BASE}:18080/RBTC/api/status"
SERVICES=(
    "xchain-encoder-btc|${BASE}:3023/health"
    "xchain-encoder-doge|${BASE}:3123/health"
    "xchain-encoder-ltc|${BASE}:3223/health"
    "xchain-hub|${BASE}:10000/health"
)

if ! command -v curl >/dev/null 2>&1; then
    echo "bootstrap.sh: curl not found in PATH" >&2
    exit 2
fi

failures=0

# reachable LABEL URL - true when the URL answers with a benign HTTP
# status. Bounded per probe with --max-time.
reachable() {
    local url="$1"
    curl -fsS --max-time 3 -o /dev/null "$url" 2>/dev/null \
        || curl -sS --max-time 3 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null \
            | grep -qE '^(200|401|404|405)$'
}

# The explorer needs more than a live socket: the whole point of the
# G163/ breakage was an explorer that answered but served no
# chain state (decoder_health "unconfigured", chain_tip null). Assert
# the status body shows decoders wired and tips populated.
if [[ -n "$VERBOSE" ]]; then
    echo "bootstrap.sh: probing xchain-explorer at $EXPLORER_STATUS_URL ..." >&2
fi
explorer_body="$(curl -fsS --max-time 4 "$EXPLORER_STATUS_URL" 2>/dev/null || true)"
if [[ -z "$explorer_body" ]]; then
    printf '  \xe2\x9c\x97  %-22s %s (no response)\n' "xchain-explorer" "$EXPLORER_STATUS_URL" >&2
    failures=$((failures + 1))
elif echo "$explorer_body" | grep -q 'unconfigured' \
        || echo "$explorer_body" | grep -qE '"chain_tip":[[:space:]]*null' \
        || ! echo "$explorer_body" | grep -q '"decoder_health"'; then
    printf '  \xe2\x9c\x97  %-22s %s (reachable but decoders not wired)\n' \
        "xchain-explorer" "$EXPLORER_STATUS_URL" >&2
    failures=$((failures + 1))
else
    printf '  \xe2\x9c\x93  %-22s %s\n' "xchain-explorer" "$EXPLORER_STATUS_URL"
fi

for entry in "${SERVICES[@]}"; do
    label="${entry%%|*}"
    url="${entry##*|}"
    if [[ -n "$VERBOSE" ]]; then
        echo "bootstrap.sh: probing $label at $url ..." >&2
    fi
    if reachable "$url"; then
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

  cd $HOME/Sites/XChain-Platform/xchain-node
  ./xchain-node.sh start

Then re-run this script. If the stack runs on another host (e.g. the
devhost regtest stack over an SSH tunnel), point the probe at it:
XCHAIN_REGTEST_BASE_URL=http://your-host.
EOF
    exit 1
fi

echo "bootstrap.sh: all regtest services responding."
