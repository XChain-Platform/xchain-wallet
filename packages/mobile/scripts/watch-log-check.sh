#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
logs="$root/tmp/watch-log-check"

usage() {
    echo "usage: packages/mobile/scripts/watch-log-check.sh --udid <watch udid> --since <start>" >&2
    exit 2
}

udid=""
since=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --udid)
            [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || usage
            udid="$2"
            shift 2
            ;;
        --since)
            [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || usage
            since="$2"
            shift 2
            ;;
        *) usage ;;
    esac
done

[ -n "$udid" ] && [ -n "$since" ] || usage

mkdir -p "$logs"
log_file="$(mktemp "$logs/log.XXXXXX")"
mv "$log_file" "$log_file.ndjson"
log_file="$log_file.ndjson"
if ! xcrun simctl spawn "$udid" log show --style ndjson --start "$since" \
    --predicate 'subsystem == "io.xchain.wallet.ios.watch"' > "$log_file"; then
    echo "watch-log-check: log show failed" >&2
    exit 1
fi
echo "watch-log-check: captured $(awk 'END { print NR }' "$log_file") entries" >&2

status=0
node packages/mobile/scripts/sim-log.js find \
    --subsystem io.xchain.wallet.ios.watch \
    --category link \
    --contains 'snapshot received v1' < "$log_file" || status=1
node packages/mobile/scripts/sim-log.js find \
    --subsystem io.xchain.wallet.ios.watch \
    --category link \
    --contains 'screen shown W1' < "$log_file" || status=1

[ "$status" -eq 0 ] || exit 1
echo "watch log: snapshot v1 and W1 seen"
