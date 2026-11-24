#!/usr/bin/env bash
# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
logs="$root/tmp/watch-test"
mkdir -p "$logs"

die() { echo "watch-test: $*" >&2; exit 1; }
usage() { die "usage: packages/mobile/scripts/watch-test.sh {watch41|watch49|phone|wear|app|gradle} [case|task ...]"; }

write_xcconfig() {
    local file="packages/mobile/ios/App/Version.xcconfig"
    [ -f "$file" ] && return
    node --input-type=module - "$root" <<'NODE'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { versionXcconfigFor } = await import(pathToFileURL(join(root, 'packages/mobile/scripts/version.js')));
const output = join(root, 'packages/mobile/ios/App/Version.xcconfig');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, versionXcconfigFor(`v${pkg.version}`));
NODE
}

resolve_xcode_destination() {
    local scheme="$1" device="$2" selection
    xcrun simctl list pairs -j > "$logs/pairs.json" || die "could not list simulator pairs"
    xcrun simctl list devices -j > "$logs/devices.json" || die "could not list simulators"
    if ! selection="$(node --input-type=module - "$logs/pairs.json" "$logs/devices.json" "$scheme" "$device" <<'NODE'
import { readFileSync } from 'node:fs';

const [pairsFile, devicesFile, scheme, wanted] = process.argv.slice(2);
const pairData = JSON.parse(readFileSync(pairsFile, 'utf8'));
const deviceData = JSON.parse(readFileSync(devicesFile, 'utf8'));
const pairs = Object.values(pairData.pairs || {});
const matches = pairs.filter((pair) => pair.phone?.name === 'XC iPhone 17'
    && (scheme === 'App' || pair.watch?.name === wanted));
const active = matches.filter((pair) => String(pair.state).toLowerCase() === 'active');
const choices = active.length === 1 ? active : matches;
const runtimeByUdid = new Map(Object.entries(deviceData.devices || {}).flatMap(([runtime, devices]) =>
    devices.map((device) => [device.udid, runtime])));

function runtimeParts(pair) {
    const device = scheme === 'App' ? pair.phone : pair.watch;
    const runtime = runtimeByUdid.get(device?.udid) || device?.runtime || device?.runtimeIdentifier
        || pair.runtime || pair.runtimeIdentifier || '';
    return [...String(runtime).matchAll(/\d+/g)].map((match) => Number(match[0]));
}

function compareRuntime(left, right) {
    const a = runtimeParts(left);
    const b = runtimeParts(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const difference = (b[index] || 0) - (a[index] || 0);
        if (difference) return difference;
    }
    const leftDevice = scheme === 'App' ? left.phone : left.watch;
    const rightDevice = scheme === 'App' ? right.phone : right.watch;
    return leftDevice.udid.localeCompare(rightDevice.udid);
}

const pair = choices.sort(compareRuntime)[0];
const selected = pair && (scheme === 'App' ? pair.phone : pair.watch);
if (!selected?.udid) process.exit(1);
process.stdout.write(`${selected.name}\t${selected.udid}`);
NODE
)"; then
        die "no paired simulator for '$device' with XC iPhone 17"
    fi
    local chosen_name destination
    IFS=$'\t' read -r chosen_name destination <<< "$selection"
    echo "watch-test: selected $chosen_name ($destination)" >&2
    printf '%s' "$destination"
}

run_xcode() {
    local scheme="$1" suite="$2" device="$3" test_case="$4" destination
    local result="$logs/${scheme}-${device// /_}.xcresult" summary="$logs/${scheme}-summary.json"
    destination="$(resolve_xcode_destination "$scheme" "$device")"
    write_xcconfig
    rm -rf "$result"
    xcodebuild test -project packages/mobile/ios/App/App.xcodeproj -scheme "$scheme" \
        -destination "id=$destination" \
        -only-testing:"$suite/$test_case" -resultBundlePath "$result" 2>&1 | tee "$logs/${scheme}.log"
    xcrun xcresulttool get test-results summary --path "$result" > "$summary"
    node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1])); process.exit(Number(r.passedTests||0)+Number(r.failedTests||0)>0?0:1)' "$summary" \
        || die "xcodebuild completed but its result bundle reports zero executed tests"
}

prepare_web() {
    if [ ! -f packages/web/dist/index.html ]; then
        pnpm --filter @xchain-wallet/web build 2>&1 | tee "$logs/web-build.log"
    fi
}

prepare_gradle() {
    export ANDROID_HOME="${XCHAIN_ANDROID_SDK:-/opt/homebrew/share/android-commandlinetools}"
    export ANDROID_USER_HOME="$logs/android-home"
    export GRADLE_USER_HOME="$logs/gradle-home"
    # Each run gets a fresh Gradle home, so parallel lanes would each re-download
    # every jar and Maven Central answers with 429s. A seeded read-only cache,
    # when the host has one, serves those jars without sharing a writable home.
    if [ -z "${GRADLE_RO_DEP_CACHE:-}" ] && [ -d "$HOME/.gradle/ro-dep-cache/modules-2" ]; then
        export GRADLE_RO_DEP_CACHE="$HOME/.gradle/ro-dep-cache"
    fi
    if [ -z "${JAVA_HOME:-}" ]; then
        [ -d /opt/homebrew/opt/openjdk@21 ] || die "JAVA_HOME is unset and /opt/homebrew/opt/openjdk@21 is absent"
        JAVA_HOME=/opt/homebrew/opt/openjdk@21
    fi
    export JAVA_HOME
    if [ ! -f packages/mobile/android/version.properties ] \
        || [ ! -f packages/mobile/www/webdir-stamp.txt ] \
        || [ ! -f packages/mobile/android/app/src/main/assets/public/webdir-stamp.txt ]; then
        prepare_web
        pnpm --filter @xchain-wallet/mobile sync 2>&1 | tee "$logs/android-sync.log"
    fi
}

prove_gradle_tests() {
    local results="$1"
    node - "$results" <<'NODE' || die "Gradle completed but its JUnit XML reports zero executed tests"
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
let total = 0;
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.name.endsWith('.xml')) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/<testsuite\b[^>]*\btests=["'](\d+)["']/g)) total += Number(match[1]);
    }
  }
}
walk(root);
process.exit(total > 0 ? 0 : 1);
NODE
}

target="${1:-}"
[ -n "$target" ] || usage
shift
case "$target" in
    watch41|watch49|phone)
        [ "$#" -eq 1 ] && [ -n "$1" ] || usage
        if [ "$target" = phone ]; then
            if [ ! -d packages/mobile/ios/App/App/public ]; then
                prepare_web
                pnpm --filter @xchain-wallet/mobile sync:ios 2>&1 | tee "$logs/ios-sync.log"
            fi
            run_xcode App AppTests "XC iPhone 17" "$1"
        else
            device="XC Watch 41mm"; [ "$target" = watch49 ] && device="XC Watch 49mm"
            run_xcode WatchApp WatchAppTests "$device" "$1"
        fi
        ;;
    wear|app)
        [ "$#" -eq 1 ] && [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_\$]*$ ]] || die "Android case must be one bare class name"
        prepare_gradle
        results="packages/mobile/android/$target/build/test-results/testDebugUnitTest"
        rm -rf "$results"
        packages/mobile/android/gradlew --no-daemon -p packages/mobile/android ":$target:testDebugUnitTest" --tests "*.$1" 2>&1 | tee "$logs/$target.log"
        prove_gradle_tests "$results"
        ;;
    gradle)
        [ "$#" -gt 0 ] || usage
        prepare_gradle
        packages/mobile/android/gradlew --no-daemon -p packages/mobile/android "$@" 2>&1 | tee "$logs/gradle.log"
        ;;
    *) usage ;;
esac
