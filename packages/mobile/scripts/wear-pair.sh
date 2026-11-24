#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
sdk="${XCHAIN_ANDROID_SDK:-/opt/homebrew/share/android-commandlinetools}"
adb="$sdk/platform-tools/adb"
emulator="$sdk/emulator/emulator"
sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$sdk/cmdline-tools/latest/bin/avdmanager"
pid_dir="$root/tmp/watch-sim"
phone_avd=xc-phone-play
watch_avd=xc-wear-large-round
phone_serial=emulator-5560
watch_serial=emulator-5570
image='system-images;android-36;google_apis_playstore;arm64-v8a'

die() { echo "wear-pair: $*" >&2; exit 1; }
usage() { echo 'usage: packages/mobile/scripts/wear-pair.sh [--device|--stop]' >&2; exit 2; }
adb_for() { "$adb" -s "$1" "${@:2}"; }

stop_started() {
    local file pid avd command
    for avd in "$phone_avd" "$watch_avd"; do
        file="$pid_dir/wear-pair-$avd.pid"
        [ -f "$file" ] || continue
        pid="$(tr -dc '0-9' < "$file")"
        command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
        if [ -n "$pid" ] && [[ "$command" == *emulator*"-avd $avd"* ]]; then
            kill "$pid" 2>/dev/null || true
        fi
        rm -f "$file"
    done
}

[ "$#" -le 1 ] || usage
if [ "${1:-}" = --stop ]; then stop_started; exit 0; fi
[ "$#" -eq 0 ] || [ "$1" = --device ] || usage
mkdir -p "$pid_dir"

boot_avd() {
    local avd="$1" serial="$2" port="$3" pid_file="$pid_dir/wear-pair-$1.pid"
    shift 3
    if adb_for "$serial" emu avd name 2>/dev/null | tr -d '\r' | grep -Fqx "$avd"; then return; fi
    "$emulator" -avd "$avd" -port "$port" -no-window -no-audio "$@" >"$pid_dir/wear-pair-$avd.log" 2>&1 &
    printf '%s\n' "$!" > "$pid_file"
    "$adb" -s "$serial" wait-for-device
    local deadline=$((SECONDS + 300))
    until [ "$(adb_for "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
        [ "$SECONDS" -lt "$deadline" ] || die "$avd did not boot"
        sleep 2
    done
}

if [ "${1:-}" = --device ]; then
    phone_serial="$("$adb" -d get-serialno 2>/dev/null)" || die 'attached LG K500 not found'
    model="$(adb_for "$phone_serial" shell getprop ro.product.model | tr -d '\r')"
    [[ "$model" == *K500* ]] || die "attached device is not the LG K500: ${model:-unknown}"
else
    export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
    printf 'y\n' | "$sdkmanager" --install "$image" >/dev/null
    if ! "$avdmanager" list avd 2>/dev/null | grep -q "Name: $phone_avd\$"; then
        printf 'no\n' | "$avdmanager" create avd -n "$phone_avd" -k "$image" -d pixel_6 >/dev/null
    fi
    boot_avd "$phone_avd" "$phone_serial" 5560
fi
boot_avd "$watch_avd" "$watch_serial" 5570 -no-snapshot

adb_for "$phone_serial" forward tcp:5601 tcp:5601
adb_for "$phone_serial" shell pm path com.google.android.wearable.app >/dev/null 2>&1 \
    || die 'missing Wear OS companion app'
adb_for "$phone_serial" shell dumpsys account 2>/dev/null | awk '
    /^[[:space:]]*Accounts: [0-9]+/ { accounts = 1; next }
    accounts && /^[[:space:]]+/ {
        entry = $0
        sub(/^[[:space:]]+/, "", entry)
        if (index(entry, "Account {") != 1) exit !found
        if ($0 ~ /type=com[.]google[},]/) found = 1
        next
    }
    accounts { exit !found }
    END { exit !found }
' || die "missing Google sign-in on $phone_serial"
adb_for "$phone_serial" shell monkey -p com.google.android.wearable.app -c android.intent.category.LAUNCHER 1 >/dev/null
adb_for "$phone_serial" shell input keyevent KEYCODE_MENU

tap_text() {
    local point
    adb_for "$phone_serial" shell uiautomator dump /sdcard/xchain-wear-pair.xml >/dev/null
    point="$(adb_for "$phone_serial" shell cat /sdcard/xchain-wear-pair.xml \
        | node packages/mobile/scripts/ui-dump.js tap --text "$1")" || die "companion app missing $1"
    read -r x y <<< "$point"
    adb_for "$phone_serial" shell input tap "$x" "$y"
}

tap_text 'Pair with emulator'
sleep 2
tap_text 'Pair'
bash packages/mobile/scripts/watch-test.sh gradle :app:assembleDebug :app:assembleDebugAndroidTest :wear:assembleDebug
adb_for "$phone_serial" install -r packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk >/dev/null
adb_for "$phone_serial" install -r packages/mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >/dev/null
adb_for "$watch_serial" install -r packages/mobile/android/wear/build/outputs/apk/debug/wear-debug.apk >/dev/null
adb_for "$phone_serial" shell am instrument -w -e class \
    io.xchain.wallet.android.watch.WatchPairedTest \
    io.xchain.wallet.android.debug.test/androidx.test.runner.AndroidJUnitRunner \
    | tr -d '\r' | tee "$pid_dir/watch-paired-test.log" | grep -Eq '^OK \(1 test\)$'
