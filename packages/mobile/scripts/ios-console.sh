#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# Based on XChain Platform by Dankest, LLC – https://dankest.llc
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# This file is part of XChain Platform. Licensed under the GNU Affero
# General Public License v3.0 or later; see LICENSE.md. A commercial
# license (without AGPL source-disclosure terms) is available -
# contact legal@dankest.llc.
#
# Read the iOS shell's NATIVE console on a simulator.
#
# WHY THIS IS A SCRIPT AND NOT A COMMAND YOU REMEMBER .
#
# The obvious command does not work, and it fails by printing NOTHING rather
# than by erroring, which is the worst way for a diagnostic channel to fail:
#
#     xcrun simctl launch --console <udid> io.xchain.wallet.ios   # silent
#
# Capacitor logs through Swift `print()`, i.e. the app's stdout. `--console`
# hands the app a PIPE, and stdio block-buffers a pipe at 4 KB. A wallet at
# rest never produces 4 KB, and the app never exits, so the buffer is never
# flushed and the whole launch sequence sits in it, invisible. Two sessions
# read that silence as "the app prints nothing" and one of them concluded a
# startup error could not be reproduced. It reproduced every single time.
#
# `NSUnbufferedIO=YES` turns the buffering off, and `SIMCTL_CHILD_` is how an
# environment variable reaches the app rather than simctl. That one variable is
# the entire difference between a blind channel and a working one; neither a
# pty, `--console-pipe`, `log stream` (os_log only, and Capacitor uses none of
# it) nor `loggingBehavior: "production"` gets you there.
#
# What the channel shows: the ⚡️ lines are Capacitor's own (plugin registry,
# page load, bridge traffic), and `⚡️  [log] - ...` lines are the SPA's
# `console.log` forwarded from the WebView. So this is the JS console too, for
# a build that has no Safari Web Inspector attached.
#
# LOGGING IS DEBUG-ONLY AND MUST STAY THAT WAY. `ios/debug.xcconfig` sets
# CAPACITOR_DEBUG = true; no Release configuration does, and Capacitor reads
# that same flag to decide `webView.isInspectable`. A store build therefore
# logs nothing and cannot be attached to by Safari, which is the posture we
# want and which `mobile-ios-shell.smoke.js` pins. That flag is also why the
# Capacitor xcframework needs it at all: it ships prebuilt in Release, so its
# own `#if DEBUG` is false no matter how WE build.
#
# Usage:
#   packages/mobile/scripts/ios-console.sh                    # build, install, stream
#   packages/mobile/scripts/ios-console.sh "iPhone 17 Pro Max"
#   SKIP_BUILD=1 packages/mobile/scripts/ios-console.sh       # reuse what is installed
#   DURATION=20 packages/mobile/scripts/ios-console.sh        # stop after N seconds
#   LOG=/tmp/run.log packages/mobile/scripts/ios-console.sh   # also tee to a file

set -euo pipefail

pkg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$pkg/ios/App/App.xcodeproj"
bundle_id="io.xchain.wallet.ios"
device="${1:-iPhone 17 Pro}"

if [ ! -d "$project" ]; then
    echo "ios-console: no Xcode project at $project" >&2
    echo "Run 'pnpm --filter @xchain-wallet/mobile sync:ios' first." >&2
    exit 1
fi

udid="$(xcrun simctl list devices available | grep -F "$device (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
if [ -z "$udid" ]; then
    echo "ios-console: no available simulator named '$device'" >&2
    xcrun simctl list devices available | grep -E 'iPhone|iPad' >&2
    exit 1
fi

xcrun simctl boot "$udid" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true

# Which web bundle is about to be read. Not a gate, unlike the screenshot
# harness: a `default` bundle is the RIGHT thing to debug against most of the
# time. But knowing which one you are looking at costs one line and a wrong
# guess costs an hour.
stamp="$pkg/www/build-profile.txt"
if [ -f "$stamp" ]; then
    echo "ios-console: staged web bundle profile is '$(tr -d '[:space:]' < "$stamp")'"
else
    echo "ios-console: no staged web bundle; run 'pnpm --filter @xchain-wallet/mobile sync:ios'" >&2
fi

if [ "${SKIP_BUILD:-}" != "1" ]; then
    derived="$(mktemp -d)"
    echo "ios-console: building Debug for the simulator"
    # CODE_SIGNING_ALLOWED=NO is deliberately NOT passed, for the same reason
    # the screenshot harness does not pass it: it strips the entitlements, the
    # Keychain then refuses the vault key with OSStatus -34018, and the console
    # fills with a vault failure that exists only because of the build flag.
    xcodebuild -project "$project" -scheme App -configuration Debug -sdk iphonesimulator \
        -destination "id=$udid" -derivedDataPath "$derived" build > "$derived/build.log" 2>&1 || {
        echo "ios-console: build failed; last errors:" >&2
        grep -E "error:" "$derived/build.log" | head -20 >&2
        exit 1
    }
    xcrun simctl install "$udid" "$derived/Build/Products/Debug-iphonesimulator/App.app"
fi

echo "ios-console: streaming $bundle_id on $device ($udid)"
echo

# The line this whole script exists for.
#
# DURATION collects and then prints, rather than streaming: `simctl launch
# --console` holds the terminal until the app exits, and killing the far end of
# a pipeline leaves simctl itself alive and the caller blocked forever. The
# interactive mode below streams live and is the one to use by hand; DURATION
# is for scripted runs that need to come back.
if [ -n "${DURATION:-}" ]; then
    out="${LOG:-$(mktemp)}"
    SIMCTL_CHILD_NSUnbufferedIO=YES \
        xcrun simctl launch --console --terminate-running-process "$udid" "$bundle_id" \
        > "$out" 2>&1 &
    console=$!
    sleep "$DURATION"
    kill "$console" 2>/dev/null || true
    wait "$console" 2>/dev/null || true
    cat "$out"
else
    SIMCTL_CHILD_NSUnbufferedIO=YES \
        xcrun simctl launch --console --terminate-running-process "$udid" "$bundle_id" \
        2>&1 | { if [ -n "${LOG:-}" ]; then tee "$LOG"; else cat; fi; }
fi
