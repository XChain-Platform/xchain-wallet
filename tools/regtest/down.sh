#!/usr/bin/env bash
# tools/regtest/down.sh - stop the upstream regtest stack (G004 /
# §52). Thin pointer at `xchain-node stop` so the wallet's test
# runners don't depend on the platform repo's exact stop command.
#
# Usage:
#   bash tools/regtest/down.sh

set -euo pipefail

PLATFORM_DIR="${XCHAIN_PLATFORM_DIR:-$HOME/Sites/XChain-Platform/xchain-node}"

if [[ ! -d "$PLATFORM_DIR" ]]; then
    cat >&2 <<EOF
down.sh: platform repo not found at $PLATFORM_DIR.

Override the path with:
  XCHAIN_PLATFORM_DIR=/path/to/xchain-node bash tools/regtest/down.sh
EOF
    exit 1
fi

if [[ ! -x "$PLATFORM_DIR/xchain-node.sh" ]]; then
    echo "down.sh: $PLATFORM_DIR/xchain-node.sh not executable" >&2
    exit 1
fi

# Delegate. Any exit code from the orchestrator surfaces directly.
exec "$PLATFORM_DIR/xchain-node.sh" stop
