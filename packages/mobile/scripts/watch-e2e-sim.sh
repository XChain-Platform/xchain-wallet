#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
logs="$root/tmp/watch-e2e-sim"
derived="$logs/DerivedData"
result="$logs/WatchPairE2E.xcresult"
mkdir -p "$logs"

die() { echo "watch-e2e-sim: $*" >&2; exit 1; }
node_bin="$(command -v node || true)"
[ -n "$node_bin" ] || die 'Node.js 22 is required'
[ "$("$node_bin" -p 'process.versions.node.split(".")[0]')" = 22 ] \
    || die 'Node.js 22 is required'

xcrun simctl list pairs -j > "$logs/pairs.json"
pair="$("$node_bin" --input-type=module - "$logs/pairs.json" <<'NODE'
import { readFileSync } from 'node:fs';
const pairs = Object.entries(JSON.parse(readFileSync(process.argv[2], 'utf8')).pairs || {});
const [id, match] = pairs.find(([, item]) => /^\(?active\b/.test(item.state || '')
    && item.phone?.name === 'XC iPhone 17'
    && item.watch?.name === 'XC Watch 41mm') || [];
if (!id || !match?.phone?.udid || !match?.watch?.udid) process.exit(1);
process.stdout.write(`${id}\t${match.phone.udid}\t${match.watch.udid}`);
NODE
)" || die 'no active XC iPhone 17 + XC Watch 41mm simulator pair'
IFS=$'\t' read -r pair_id phone watch <<< "$pair"

if [ ! -f packages/mobile/ios/App/Version.xcconfig ]; then
    "$node_bin" --input-type=module - "$root" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { versionXcconfigFor } from './packages/mobile/scripts/version.js';
const root = process.argv[2];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(root, 'packages/mobile/ios/App/Version.xcconfig'), versionXcconfigFor(`v${pkg.version}`));
NODE
fi
if [ ! -d packages/mobile/ios/App/App/public ]; then
    pnpm --filter @xchain-wallet/web build
    pnpm --filter @xchain-wallet/mobile sync:ios
fi

xcrun simctl boot "$phone" >/dev/null 2>&1 || true
xcrun simctl boot "$watch" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$phone" -b
xcrun simctl bootstatus "$watch" -b
rm -rf "$derived" "$result"
rm -f "$logs/summary.json" "$logs/test.log" "$logs/watch-launch.txt" \
    "$logs/watch-process.ndjson"
xcodebuild build-for-testing -project packages/mobile/ios/App/App.xcodeproj \
    -scheme AppUITests -configuration Debug \
    -destination "id=$phone" -derivedDataPath "$derived" \
    > "$logs/build.log" 2>&1 || die "build failed; see $logs/build.log"

app="$derived/Build/Products/Debug-iphonesimulator/App.app"
watch_app="$app/Watch/WatchApp.app"
[ -d "$app" ] || die "phone app not built at $app"
[ -d "$watch_app" ] || die "embedded watch app not built at $watch_app"
xcrun simctl uninstall "$phone" io.xchain.wallet.ios >/dev/null 2>&1 || true
xcrun simctl uninstall "$watch" io.xchain.wallet.ios.watch >/dev/null 2>&1 || true
xcrun simctl install "$phone" "$app"
xcrun simctl install "$watch" "$watch_app"
xcrun simctl get_app_container "$phone" io.xchain.wallet.ios >/dev/null
xcrun simctl get_app_container "$watch" io.xchain.wallet.ios.watch >/dev/null
since="$(date '+%Y-%m-%d %H:%M:%S')"
xcrun simctl launch "$watch" io.xchain.wallet.ios.watch >/dev/null

test_status=0
xcodebuild test-without-building -project packages/mobile/ios/App/App.xcodeproj \
    -scheme AppUITests -destination "id=$phone" -derivedDataPath "$derived" \
    -only-testing:AppUITests/WatchPairE2ETests -resultBundlePath "$result" \
    2>&1 | tee "$logs/test.log" || test_status=$?
summary_status=1
if [ -d "$result" ] \
    && xcrun xcresulttool get test-results summary --path "$result" > "$logs/summary.json"; then
    "$node_bin" -e 'const r=require("./tmp/watch-e2e-sim/summary.json"); process.exit(r.passedTests===1&&r.failedTests===0?0:1)' \
        && summary_status=0
fi
xcrun simctl launch --terminate-running-process "$watch" io.xchain.wallet.ios.watch \
    > "$logs/watch-launch.txt" || true

capture_watch_process_log() {
    xcrun simctl spawn "$watch" log show --style ndjson --start "$since" \
        --predicate 'process == "WatchApp"' > "$logs/watch-process.ndjson" || true
    echo "watch-e2e-sim: captured $(awk 'END { print NR + 0 }' "$logs/watch-process.ndjson") WatchApp process entries"
}

if [ "$test_status" -ne 0 ]; then
    capture_watch_process_log
    die "UI test failed with status $test_status; see $logs/test.log and $logs/summary.json"
fi
if [ "$summary_status" -ne 0 ]; then
    capture_watch_process_log
    die 'result bundle does not report one passing WatchPairE2E test'
fi

log_status=1
check_output=""
for _ in {1..10}; do
    if check_output="$(bash packages/mobile/scripts/watch-log-check.sh \
        --udid "$watch" --since "$since" 2>&1)"; then
        log_status=0
        break
    fi
    sleep 2
done
capture_watch_process_log
echo "$check_output"
exit "$log_status"
