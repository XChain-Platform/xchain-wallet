#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
mkdir -p tmp
case_name="${1:-}"
[[ "$case_name" =~ ^(balances|alerts|privacy)$ ]] || {
    echo "wear-acceptance: usage: packages/mobile/scripts/wear-acceptance.sh {balances|alerts|privacy}" >&2
    exit 1
}

die() { echo "wear-acceptance: missing $1" >&2; exit 1; }
adb_for() { adb -s "$1" "${@:2}"; }
serial_for() {
    local role="$1" serial characteristics
    serial="${!role:-}"
    [ -n "$serial" ] && { printf '%s' "$serial"; return; }
    while read -r serial state _; do
        [ "$state" = device ] || continue
        characteristics="$(adb_for "$serial" shell getprop ro.build.characteristics 2>/dev/null || true)"
        if { [ "$role" = WEAR_WATCH_SERIAL ] && [[ "$characteristics" == *watch* ]]; } \
            || { [ "$role" = WEAR_PHONE_SERIAL ] && [[ "$characteristics" != *watch* ]]; }; then
            printf '%s' "$serial"
            return
        fi
    done < <(adb devices -l | tail -n +2)
    die "${role,,}"
}
dump_ui() {
    adb_for "$watch" shell uiautomator dump /sdcard/xchain-wear.xml >/dev/null
    adb_for "$watch" shell cat /sdcard/xchain-wear.xml
}
require_dump() {
    local label="$1" pattern="$2" dump
    dump="$(dump_ui)"
    printf '%s' "$dump" | grep -Eiq "$pattern" || die "$label"
}

# wear-pair.sh boots this pair; a USB phone such as the LG test device must not be picked.
: "${WEAR_PHONE_SERIAL:=emulator-5560}"
: "${WEAR_WATCH_SERIAL:=emulator-5570}"
phone="$(serial_for WEAR_PHONE_SERIAL)"
watch="$(serial_for WEAR_WATCH_SERIAL)"
bash packages/mobile/scripts/watch-test.sh gradle :app:assembleDebug :app:assembleDebugAndroidTest :wear:assembleDebug
adb_for "$phone" install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb_for "$phone" install -r packages/mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb_for "$watch" install -r packages/mobile/android/wear/build/outputs/apk/debug/wear-debug.apk
adb_for "$phone" shell am instrument -w -e class \
    "io.xchain.wallet.android.watch.WatchAcceptanceDriverTest#$case_name" \
    io.xchain.wallet.android.debug.test/androidx.test.runner.AndroidJUnitRunner

if [ "$case_name" = balances ]; then
    expected="tmp/wear-acceptance-expected.$$"
    seen="tmp/wear-acceptance-seen.$$"
    trap 'rm -f "$expected" "$seen"' EXIT
    node --input-type=module - test/fixtures/watch/expected/balances.json > "$expected" <<'NODE'
import { readFileSync } from 'node:fs';
const model = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const entry = model['snapshot-rows50'] ?? model.rows50;
if (!entry) process.exit(1);
const lines = [];
const visit = (value) => {
    if (typeof value === 'string' && value) lines.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
};
visit(entry);
process.stdout.write(`${[...new Set(lines)].join('\n')}\n`);
NODE
    : > "$seen"
    deadline=$((SECONDS + ${WEAR_ACCEPTANCE_TIMEOUT_SECONDS:-60}))
    while :; do
        dump_ui >> "$seen"
        missing="$(while IFS= read -r line; do grep -Fq -- "$line" "$seen" || { printf '%s' "$line"; break; }; done < "$expected")"
        [ -z "$missing" ] && break
        [ "$SECONDS" -ge "$deadline" ] && die "$missing"
        adb_for "$watch" shell input swipe 225 360 225 100 100
    done
    adb_for "$watch" shell input tap 225 225
    require_dump "detail-native W2 price line node" '<node[^>]+(text|content-desc)="7-day price line"'
    adb_for "$watch" shell input keyevent KEYCODE_BACK
    adb_for "$watch" shell input tap 330 80
    require_dump "W6 address" '(xch|txch|bc1|0x)[[:alnum:]]{12,}'
elif [ "$case_name" = alerts ]; then
    notifications="$(adb_for "$watch" shell dumpsys notification)"
    printf '%s' "$notifications" | node packages/mobile/scripts/dumpsys-notify.js find \
        --title 'Watch acceptance alert' || die "bridged alert"
    printf '%s' "$notifications" | node packages/mobile/scripts/dumpsys-notify.js find \
        --title 'Payment due' --action 'Open on phone' || die "payment due with Open on phone"
    adb_for "$watch" shell input tap 370 80
    require_dump "W3 Watch acceptance alert" 'Watch acceptance alert'
    adb_for "$watch" shell am broadcast -a io.xchain.wallet.android.wear.DEBUG_SURFACE --es surface complication >/dev/null
    require_dump "complication text" 'complication.{0,40}(text|alert|\$|[0-9])'
    adb_for "$watch" shell am broadcast -a io.xchain.wallet.android.wear.DEBUG_SURFACE --es surface tile >/dev/null
    require_dump "Tile text" 'tile.{0,40}(text|alert|\$|[0-9])'
else
    require_dump "hidden dots" '••••|&#8226;&#8226;&#8226;&#8226;'
    adb_for "$watch" shell input tap 225 225
    require_dump 'Show wallet on watch is off on your phone' 'Show wallet on watch is off on your phone'
fi
