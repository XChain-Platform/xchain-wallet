#!/usr/bin/env bash
# Copyright (c) 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
device='XC iPhone Duo'
scratch="$repo/tmp/duo-measure"
out="$repo/test/fixtures/duo/measured-widths.json"
writer="$repo/packages/mobile/scripts/duo-fixture.js"
shim_dir="$scratch/bin"
probe_app="$scratch/App"
source_project="$repo/packages/mobile/ios/App/App.xcodeproj"
probe_project="$probe_app/App.xcodeproj"
bundle_id='io.xchain.wallet.ios'
mkdir -p "$scratch"

bash "$repo/packages/mobile/scripts/watch-sim-setup.sh" --check duo
( cd "$repo" && pnpm --filter @xchain-wallet/web build >/dev/null )
( cd "$repo" && pnpm --filter @xchain-wallet/mobile sync:ios >/dev/null )
rm -rf "$probe_app"
ditto "$repo/packages/mobile/ios/App" "$probe_app"
cp "$repo/packages/mobile/ios/debug.xcconfig" "$scratch/debug.xcconfig"
controller="$probe_app/App/MainViewController.swift"
watch_host="$probe_app/App/watch/WatchSessionHost.swift"
watch_plugin="$probe_app/App/watch/XChainWatchPlugin.swift"
if grep -q 'var onIntent:' "$watch_host" && grep -q 'extension WatchSessionHost {' "$watch_plugin"; then
    perl -0pi -e 's/private var watchIntentHandlerKey: UInt8 = 0\n\nextension WatchSessionHost \{.*?\n\}\n\n(?=\@objc\(XChainWatchPlugin\))//s' "$watch_plugin"
    ! grep -q 'extension WatchSessionHost {' "$watch_plugin"
fi
if ! grep -q 'private var foldPublisher: FoldPublisher?' "$controller"; then
    perl -0pi -e 's/(    private var launchCover: UIView\?\n)/$1    private var foldPublisher: FoldPublisher?\n/' "$controller"
fi
if ! grep -q 'FoldPublisher(webView: webView)' "$controller"; then
    perl -0pi -e 's/(        bridge\?\.registerPluginInstance\(XChainActivityPlugin\(\)\)\n)/$1\n        if let webView {\n            let publisher = FoldPublisher(webView: webView)\n            publisher.start()\n            foldPublisher = publisher\n        }\n/' "$controller"
fi
grep -q 'private var foldPublisher: FoldPublisher?' "$controller"
grep -q 'FoldPublisher(webView: webView)' "$controller"

udid="$(xcrun simctl list devices available | grep -F "$device (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
[ -n "$udid" ] || { echo "duo-measure: missing $device" >&2; exit 1; }

mkdir -p "$shim_dir"
printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'args=()' \
    'while [ "$#" -gt 0 ]; do' \
    '    if [ "$1" = "-sdk" ] && [ "${2:-}" = "iphonesimulator" ]; then shift 2; continue; fi' \
    '    if [ "$1" = "-project" ] && [ "${2:-}" = "$DUO_SOURCE_PROJECT" ]; then' \
    '        args+=("$1" "$DUO_PROBE_PROJECT"); shift 2; continue' \
    '    fi' \
    '    args+=("$1")' \
    '    shift' \
    'done' \
    'exec "$DUO_XCODEBUILD" "${args[@]}"' > "$shim_dir/xcodebuild"
chmod +x "$shim_dir/xcodebuild"
real_xcodebuild="$(xcrun -f xcodebuild)"
derived="$scratch/DerivedData"
build_log="$scratch/build.log"
app="$derived/Build/Products/Debug-iphonesimulator/App.app"
rm -rf "$derived"
if ! PATH="$shim_dir:$PATH" DUO_XCODEBUILD="$real_xcodebuild" \
    DUO_SOURCE_PROJECT="$source_project" DUO_PROBE_PROJECT="$probe_project" \
    xcodebuild -project "$source_project" -scheme App -configuration Debug \
    -sdk iphonesimulator -destination "id=$udid" -derivedDataPath "$derived" \
    build > "$build_log" 2>&1; then
    echo "duo-measure: build failed; last errors:" >&2
    grep -E 'error:' "$build_log" | head -20 >&2 || true
    exit 1
fi

wait_for_springboard() {
    local deadline pid last_pid='' stable=0
    deadline=$((SECONDS + 60))
    while [ "$SECONDS" -lt "$deadline" ]; do
        pid="$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null \
            | awk '$1 ~ /^[0-9]+$/ && $2 == 0 \
                && $3 ~ /(^|[.])SpringBoard$/ { print $1; exit }' \
            || true)"
        if [ -n "$pid" ] && [ "$pid" = "$last_pid" ]; then
            stable=$((stable + 1))
        else
            last_pid="$pid"
            stable=0
        fi
        [ "$stable" -ge 3 ] && return 0
        sleep 1
    done
    return 1
}

log="$scratch/boot-state.log"
fold_log="$scratch/boot-state.fold.log"
diagnose_capture() {
    local container jobs
    echo "duo-measure: capture diagnostics" >&2
    if [ -s "$log" ]; then
        echo "duo-measure: last 40 console lines:" >&2
        tail -40 "$log" >&2
    elif [ -e "$log" ]; then
        echo "duo-measure: console log is empty" >&2
    else
        echo "duo-measure: console log was not created" >&2
    fi
    container="$(xcrun simctl get_app_container "$udid" "$bundle_id" 2>&1 || true)"
    echo "duo-measure: app container: ${container:-not installed}" >&2
    jobs="$(xcrun simctl spawn "$udid" launchctl list 2>&1 || true)"
    echo "duo-measure: launchctl list before stopping console:" >&2
    printf '%s\n' "$jobs" >&2
    if [[ "$jobs" == *"$bundle_id"* ]]; then
        echo "duo-measure: app running: yes" >&2
    else
        echo "duo-measure: app running: no" >&2
    fi
}

launch_pid=''
stop_launch() {
    if [ -n "$launch_pid" ]; then
        kill "$launch_pid" 2>/dev/null || true
        wait "$launch_pid" 2>/dev/null || true
        launch_pid=''
    fi
}
trap stop_launch EXIT

xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
xcrun simctl boot "$udid" >/dev/null
xcrun simctl bootstatus "$udid" -b >/dev/null
if ! wait_for_springboard; then
    echo "duo-measure: SpringBoard did not become stable after a clean boot" >&2
    diagnose_capture
    exit 1
fi
xcrun simctl install "$udid" "$app"

: > "$log"
SIMCTL_CHILD_NSUnbufferedIO=YES \
    xcrun simctl launch --console --terminate-running-process \
    "$udid" "$bundle_id" > "$log" 2>&1 &
launch_pid=$!
deadline=$((SECONDS + 90))
while [ "$SECONDS" -lt "$deadline" ]; do
    grep -Fq 'fold: ' "$log" && break
    kill -0 "$launch_pid" 2>/dev/null || break
    sleep 1
done
if ! grep -Fq 'fold: ' "$log"; then
    echo "duo-measure: first fold line did not arrive" >&2
    diagnose_capture
    stop_launch
    exit 1
fi
stop_launch
awk 'index($0, "fold: ") { print; exit }' "$log" > "$fold_log"

metadata="$(node --input-type=module - "$fold_log" <<'NODE'
import { readFileSync } from 'node:fs';

const line = readFileSync(process.argv[2], 'utf8').trim();
const fold = JSON.parse(line.slice(line.indexOf('fold: ') + 6));
let state;
if (fold.posture === 'partial') {
    state = `partial-${fold.division.orientation}`;
} else if (fold.posture === 'closed' || fold.posture === 'open') {
    const orientation = fold.viewport.width <= fold.viewport.height ? 'portrait' : 'landscape';
    state = `${fold.posture}-${orientation}`;
}
if (!state || !['inner', 'outer'].includes(fold.display)) process.exit(1);
process.stdout.write(`${state}\t${fold.posture}\t${fold.display}`);
NODE
)"
IFS=$'\t' read -r measured_state measured_posture measured_display <<< "$metadata"
case "$measured_state" in
    closed-portrait|closed-landscape|open-portrait|open-landscape|partial-vertical|partial-horizontal) ;;
    *) echo "duo-measure: unsupported boot fold state ${measured_state:-unknown}" >&2; exit 1 ;;
esac
echo "duo-measure: measured $measured_state, posture $measured_posture, display $measured_display"

reason='simctl io screenConfig crashes SpringBoard on this simulator runtime'
args=(write --device "$device" --out "$out")
for state in closed-portrait closed-landscape open-portrait open-landscape partial-vertical partial-horizontal; do
    if [ "$state" = "$measured_state" ]; then
        args+=(--state "$state=$fold_log")
    else
        args+=(--unreachable "$state=$reason")
    fi
done
node "$writer" "${args[@]}"
