#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
sdk="${XCHAIN_ANDROID_SDK:-/opt/homebrew/share/android-commandlinetools}"
sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$sdk/cmdline-tools/latest/bin/avdmanager"
emulator="$sdk/emulator/emulator"
image='system-images;android-36;android-wear-signed;arm64-v8a'
image_path='system-images/android-36/android-wear-signed/arm64-v8a/'
pid_dir="$repo/tmp/watch-sim"
export JAVA_HOME=/opt/homebrew/opt/openjdk@21

json_find() {
    node -e '
const fs = require("fs");
const [kind, wanted, other] = process.argv.slice(1);
let data = {};
try { data = JSON.parse(fs.readFileSync(0, "utf8")); } catch {}
if (kind === "runtime") {
  const item = (data.runtimes || []).find((r) => r.isAvailable !== false &&
    (r.supportedDeviceTypes || []).some((d) => d.identifier === wanted));
  if (item) process.stdout.write(item.identifier);
} else if (kind === "platform") {
  const item = (data.runtimes || []).find((r) => r.isAvailable !== false &&
    r.version === other && (r.name || "").startsWith(`${wanted} `));
  if (item) process.stdout.write(item.identifier);
} else if (kind === "device") {
  let known = [];
  try { known = JSON.parse(process.env.XC_RUNTIMES || "{}").runtimes || []; } catch {}
  const supported = new Set(known.filter((r) => r.isAvailable !== false &&
    (r.supportedDeviceTypes || []).some((t) => t.identifier === other)).map((r) => r.identifier));
  const item = Object.entries(data.devices || {}).filter(([runtime]) => supported.has(runtime))
    .flatMap(([, list]) => list).find((d) =>
      d.isAvailable !== false && d.name === wanted && d.deviceTypeIdentifier === other);
  if (item) process.stdout.write(item.udid);
} else if (kind === "device-description") {
  const items = Object.entries(data.devices || {}).flatMap(([runtime, list]) =>
    list.filter((d) => d.name === wanted).map((d) =>
      `${d.deviceTypeIdentifier || "unknown type"} on ${runtime}`));
  process.stdout.write(items.join("; "));
} else if (kind === "pair") {
  const item = Object.entries(data.pairs || {}).find(([, p]) =>
    p.watch && p.phone && p.watch.udid === wanted && p.phone.udid === other);
  if (item) process.stdout.write(item[0]);
}' "$@"
}

runtimes() { xcrun simctl list runtimes -j 2>/dev/null || printf '{"runtimes":[]}\n'; }
devices() { xcrun simctl list devices -j 2>/dev/null || printf '{"devices":{}}\n'; }
pairs() { xcrun simctl list pairs -j 2>/dev/null || printf '{"pairs":{}}\n'; }
runtime_for() { runtimes | json_find runtime "$1"; }
platform_runtime() { runtimes | json_find platform "$1" 27.2; }
device_id() { devices | XC_RUNTIMES="$(runtimes)" json_find device "$1" "com.apple.CoreSimulator.SimDeviceType.$2"; }
device_description() { devices | json_find device-description "$1"; }
pair_id() { pairs | json_find pair "$1" "$2"; }

ensure_platform() {
    [ -n "$(platform_runtime "$1")" ] || xcodebuild -downloadPlatform "$1" -buildVersion 27.2
}

ensure_device() {
    local name="$1" type="$2" id runtime
    id="$(device_id "$name" "$type")"
    if [ -z "$id" ]; then
        runtime="$(runtime_for "com.apple.CoreSimulator.SimDeviceType.$type")"
        [ -n "$runtime" ] || { echo "runtime: no runtime supports $type" >&2; return 1; }
        id="$(xcrun simctl create "$name" "com.apple.CoreSimulator.SimDeviceType.$type" "$runtime")"
    fi
    printf '%s' "$id"
}

ensure_pair() {
    local watch="$1" phone="$2" pair
    pair="$(pair_id "$watch" "$phone")"
    [ -n "$pair" ] || pair="$(xcrun simctl pair "$watch" "$phone")"
    xcrun simctl pair_activate "$pair" >/dev/null
}

avd_config() {
    local output
    output="$("$avdmanager" list avd 2>/dev/null)"
    awk -v wanted="$1" '
        $1 == "Name:" { selected = ($2 == wanted) }
        selected && !found && $1 == "Path:" {
            sub(/^[[:space:]]*Path:[[:space:]]*/, "")
            print $0 "/config.ini"
            found = 1
        }
    ' <<< "$output"
}

avd_valid() {
    local config dp="$3"
    config="$(avd_config "$1")"
    [ -f "$config" ] &&
        grep -Fqx "hw.device.name=$2" "$config" &&
        grep -Fqx "image.sysdir.1=$image_path" "$config" &&
        awk -F= -v expected="$dp" '
            $1 == "hw.lcd.width" { width = $2 }
            $1 == "hw.lcd.height" { height = $2 }
            $1 == "hw.lcd.density" { density = $2 }
            END {
                valid = density > 0 && width * 160 == expected * density &&
                    height * 160 == expected * density
                exit !valid
            }
        ' "$config"
}

ensure_avd() {
    local name="$1" device="$2" dp="$3"
    avd_valid "$name" "$device" "$dp" || "$avdmanager" create avd --force \
        --name "$name" --package "$image" --device "$device" <<< 'no'
}

setup() {
    ensure_platform iOS
    ensure_platform watchOS
    local phone small large duo_runtime
    phone="$(ensure_device 'XC iPhone 17' iPhone-17)"
    small="$(ensure_device 'XC Watch 41mm' Apple-Watch-Series-9-41mm)"
    large="$(ensure_device 'XC Watch 49mm' Apple-Watch-Ultra-4-49mm)"
    duo_runtime="$(runtime_for com.apple.CoreSimulator.SimDeviceType.iPhone-Duo)"
    if [ -n "$duo_runtime" ]; then
        ensure_device 'XC iPhone Duo' iPhone-Duo >/dev/null
    else
        echo 'duo: no runtime supports iPhone-Duo'
    fi
    ensure_pair "$small" "$phone"
    ensure_pair "$large" "$phone"
    [ -x "$sdkmanager" ] || { echo "android: missing sdkmanager at $sdkmanager" >&2; return 1; }
    [ -x "$avdmanager" ] || { echo "android: missing avdmanager at $avdmanager" >&2; return 1; }
    "$sdkmanager" --sdk_root="$sdk" 'platform-tools' 'emulator' "$image"
    [ -x "$emulator" ] || { echo "android: missing emulator at $emulator" >&2; return 1; }
    ensure_avd xc-wear-small-round wearos_small_round 192
    ensure_avd xc-wear-large-round wearos_large_round 227
}

missing=0
miss() { echo "$1" >&2; missing=1; }

check_device() {
    local found expected
    expected="com.apple.CoreSimulator.SimDeviceType.$2"
    if [ -z "$(device_id "$1" "$2")" ]; then
        found="$(device_description "$1")"
        miss "device: $1 must use $expected on a runtime that supports it; found ${found:-nothing}"
    fi
}

check_pair() {
    local watch phone type="$2"
    watch="$(device_id "$1" "$type")"
    phone="$(device_id 'XC iPhone 17' iPhone-17)"
    if [ -z "$watch" ] || [ -z "$phone" ] || [ -z "$(pair_id "$watch" "$phone")" ]; then
        miss "pair: missing XC iPhone 17 + $1"
    fi
}

config_value() {
    awk -F= -v wanted="$2" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$1"
}

check_avd() {
    local name="$1" device="$2" dp="$3" config actual
    config="$(avd_config "$name")"
    if [ -z "$config" ] || [ ! -f "$config" ]; then
        miss "android: missing AVD $name"
        return
    fi
    actual="$(config_value "$config" hw.device.name)"
    [ "$actual" = "$device" ] || \
        miss "android: AVD $name hw.device.name expected $device, found ${actual:-missing}"
    actual="$(config_value "$config" image.sysdir.1)"
    [ "$actual" = "$image_path" ] || \
        miss "android: AVD $name image.sysdir.1 expected $image_path, found ${actual:-missing}"
    awk -F= -v expected="$dp" '
        $1 == "hw.lcd.width" { width = $2 }
        $1 == "hw.lcd.height" { height = $2 }
        $1 == "hw.lcd.density" { density = $2 }
        END { exit !(density > 0 && width * 160 == expected * density &&
            height * 160 == expected * density) }
    ' "$config" || miss "android: AVD $name logical size expected ${dp} dp"
}

check() {
    local installed
    [ -n "$(platform_runtime iOS)" ] || miss 'runtime: missing iOS 27.2'
    [ -n "$(platform_runtime watchOS)" ] || miss 'runtime: missing watchOS 27.2'
    check_device 'XC iPhone 17' iPhone-17
    check_device 'XC Watch 41mm' Apple-Watch-Series-9-41mm
    check_device 'XC Watch 49mm' Apple-Watch-Ultra-4-49mm
    check_pair 'XC Watch 41mm' Apple-Watch-Series-9-41mm
    check_pair 'XC Watch 49mm' Apple-Watch-Ultra-4-49mm
    [ -x "$sdkmanager" ] || miss "android: missing sdkmanager at $sdkmanager"
    [ -x "$avdmanager" ] || miss "android: missing avdmanager at $avdmanager"
    [ -x "$emulator" ] || miss "android: missing emulator at $emulator"
    if [ -x "$sdkmanager" ]; then
        installed="$("$sdkmanager" --sdk_root="$sdk" --list_installed 2>/dev/null)"
        [[ "$installed" == *"$image"* ]] || \
            miss "android: missing image $image"
    fi
    if [ -x "$avdmanager" ]; then
        check_avd xc-wear-small-round wearos_small_round 192
        check_avd xc-wear-large-round wearos_large_round 227
    fi
    return "$missing"
}

check_duo() {
    if [ -z "$(runtime_for com.apple.CoreSimulator.SimDeviceType.iPhone-Duo)" ]; then
        echo 'duo: no runtime supports iPhone-Duo'
        return 1
    fi
    [ -n "$(device_id 'XC iPhone Duo' iPhone-Duo)" ] || \
        { echo 'device: missing XC iPhone Duo' >&2; return 1; }
}

boot_wear() {
    local size="$1" avd port serial pid_file deadline state boot adb="$sdk/platform-tools/adb"
    case "$size" in
        small) avd=xc-wear-small-round; port=5572 ;;
        large) avd=xc-wear-large-round; port=5570 ;;
        *) echo 'usage: watch-sim-setup.sh --boot-wear small|large' >&2; return 2 ;;
    esac
    [ -x "$emulator" ] || { echo "android: missing emulator at $emulator" >&2; return 1; }
    [ -x "$adb" ] || { echo "android: missing adb at $adb" >&2; return 1; }
    mkdir -p "$pid_dir"
    pid_file="$pid_dir/$size.pid"
    "$emulator" -avd "$avd" -no-window -no-audio -no-snapshot -port "$port" >"$pid_dir/$size.log" 2>&1 &
    printf '%s\n' "$!" > "$pid_file"
    serial="emulator-$port"
    deadline=$((SECONDS + 180))
    while (( SECONDS < deadline )); do
        state="$("$adb" -s "$serial" get-state 2>/dev/null || true)"
        boot=
        if [ "$state" = device ]; then
            boot="$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
        fi
        [ "$boot" = 1 ] && { printf '%s\n' "$serial"; return; }
        sleep 1
    done
    echo "android: $serial did not reach device and complete boot within 180 seconds" >&2
    return 1
}

stop_wear() {
    local file pid
    for file in "$pid_dir"/small.pid "$pid_dir"/large.pid; do
        [ -f "$file" ] || continue
        pid="$(tr -dc '0-9' < "$file")"
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
        rm -f "$file"
    done
}

case "${1:-}" in
    '') [ "$#" -eq 0 ] || exit 2; setup ;;
    --check) if [ "${2:-}" = duo ]; then [ "$#" -eq 2 ] || exit 2; check_duo; else [ "$#" -eq 1 ] || exit 2; check; fi ;;
    --boot-wear) [ "$#" -eq 2 ] || exit 2; boot_wear "$2" ;;
    --stop-wear) [ "$#" -eq 1 ] || exit 2; stop_wear ;;
    *) echo 'usage: watch-sim-setup.sh [--check [duo]|--boot-wear small|large|--stop-wear]' >&2; exit 2 ;;
esac
