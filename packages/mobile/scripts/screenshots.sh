#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# App Store screenshot harness driver (§6).
#
# Produces the iPhone AND iPad listing sets. For a universal app a missing
# iPad set BLOCKS submission, so both idioms run by default and a partial run
# is an explicit choice rather than an oversight.
#
# WHY IT UNINSTALLS FIRST, which is the whole reason this is a script and not
# a bare `xcodebuild test`: the wallet PERSISTS its onboarding state. A second
# run therefore launches straight past the license into an existing wallet,
# every selector in the harness misses, and the failure reads as "the UI
# changed" when the only thing that changed is that the app remembered you.
# Uninstalling is what makes the run deterministic.
#
# Usage:
#   packages/mobile/scripts/screenshots.sh                # both idioms
#   packages/mobile/scripts/screenshots.sh "iPhone 17 Pro"
#   SKIP_BUILD=1 packages/mobile/scripts/screenshots.sh   # reuse staged bundle

set -euo pipefail

pkg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$pkg/../.." && pwd)"
project="$pkg/ios/App/App.xcodeproj"
outdir="$pkg/screenshots"
bundle_id="io.xchain.wallet.ios"

# Defaults chosen as the LARGEST current iPhone and iPad, because App Store
# Connect derives smaller sizes from the largest set but never the reverse.
# Confirm the required sizes in ASC at submission; Apple changes them.
if [ "$#" -gt 0 ]; then
    devices=("$@")
    capture_watches=0
else
    devices=("iPhone 17 Pro Max" "iPad Pro 13-inch (M5)" "XC iPhone Duo")
    capture_watches=1
fi

if [ ! -d "$project" ]; then
    echo "screenshots: no Xcode project at $project" >&2
    echo "Run 'pnpm --filter @xchain-wallet/mobile sync:ios' first." >&2
    exit 1
fi

# The listing must show the app users actually get, which is the `store`
# profile with its store CSP and no sourcemaps. If `HIDDEN_SURFACES.store`
# ever hides a surface, a `default` screenshot would advertise a feature the
# shipped app lacks; today both profiles carry the same product surfaces.
if [ "${SKIP_BUILD:-}" != "1" ]; then
    echo "screenshots: building the web shell at the store profile"
    ( cd "$repo" && XCHAIN_BUILD_PROFILE=store pnpm --filter @xchain-wallet/web build >/dev/null )
    ( cd "$repo" && pnpm --filter @xchain-wallet/mobile sync:ios >/dev/null )
fi

# ASSERTED, NOT ASSUMED, and asserted even when the build was skipped.
#
# This caught a real one: a run with SKIP_BUILD=1 picked up a `default` bundle
# that an unrelated test had restaged, and the screenshots came out showing the
# DeFi tab. Those images would have gone into an App Store listing advertising
# a surface the shipped store build compiles out, which is the exact §2.3
# problem the profile exists to prevent, and nothing about the screenshots
# looked wrong. A wrong-profile set is worse than no set.
# Since 2026-10-09 the store build hides no surface; this check remains the
# guard for its CSP, sourcemap setting and any future registry change.
stamp="$pkg/www/build-profile.txt"
if [ ! -f "$stamp" ]; then
    echo "screenshots: no build-profile stamp at $stamp; the bundle was never staged" >&2
    exit 1
fi
profile="$(tr -d '[:space:]' < "$stamp")"
if [ "$profile" != "store" ]; then
    echo "screenshots: staged bundle is profile '$profile', refusing to shoot a listing set." >&2
    echo "  A '$profile' build has the wrong CSP, sourcemap setting and profile stamp." >&2
    echo "  Re-run without SKIP_BUILD=1, or stage a store build by hand:" >&2
    echo "    XCHAIN_BUILD_PROFILE=store pnpm --filter @xchain-wallet/web build" >&2
    echo "    pnpm --filter @xchain-wallet/mobile sync:ios" >&2
    exit 1
fi
echo "screenshots: staged bundle profile is '$profile'"

mkdir -p "$outdir"

for device in "${devices[@]}"; do
    echo
    echo "=== $device ==="
    slug="$(echo "$device" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
    dest="$outdir/$slug"
    rm -rf "$dest"; mkdir -p "$dest"

    # Let a no-match grep pass under pipefail so the missing-simulator message below prints
    udid="$(xcrun simctl list devices available | { grep -F "$device (" || true; } | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
    if [ -z "$udid" ]; then
        echo "screenshots: no available simulator named '$device'" >&2
        echo "Available:" >&2
        xcrun simctl list devices available | grep -E 'iPhone|iPad' >&2
        exit 1
    fi

    xcrun simctl boot "$udid" >/dev/null 2>&1 || true
    xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true

    # ENROL A FACE BEFORE SHOOTING, or scene 4 advertises the opposite of what
    # it exists to say. A fresh simulator has no biometry enrolled, so the
    # wallet's Safety panel renders "Biometric unlock - Not available. No
    # fingerprint or face is set up on this device yet", and that sentence is
    # what lands on the App Store listing under a screenshot meant to show
    # biometric unlock. Measured 2026-08-10: the harness reached the row,
    # asserted it was in frame, passed, and produced exactly that image - a
    # green run over a picture that undercuts §2.1's native-integration
    # defence. Enrolment is a simulator state, not app state, so it belongs
    # here beside the uninstall rather than in the test.
    xcrun simctl spawn "$udid" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 >/dev/null 2>&1 || true
    xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit.enrollmentChanged >/dev/null 2>&1 || true

    # LIGHT THEME AND A CLEAN STATUS BAR, SET ON THE SIMULATOR. The wallet's
    # default theme is "system", so the listing's theme is whatever the
    # simulator was last left in: the 0.341.4 set came out dark because the
    # host simulator was. The listing is shot light, so the appearance is
    # forced here rather than trusted. The status bar override gives every
    # image the same 9:41, full bars and charged battery instead of the
    # wall clock of the run.
    xcrun simctl ui "$udid" appearance light
    xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
        --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

    # The line this whole script exists for.
    xcrun simctl uninstall "$udid" "$bundle_id" >/dev/null 2>&1 || true

    result="$(mktemp -d)/run.xcresult"
    # CODE_SIGNING_ALLOWED=NO is deliberately NOT passed: it strips the app's
    # entitlements, the Keychain refuses the vault key (OSStatus -34018), and
    # every screenshot is of the "device needs to be unlocked" error screen.
    set +e
    xcodebuild test \
        -project "$project" \
        -scheme AppUITests \
        -destination "id=$udid" \
        -resultBundlePath "$result" \
        -only-testing:AppUITests/ScreenshotTests/testCaptureListingScreenshots \
        > "$dest/xcodebuild.log" 2>&1
    status=$?
    set -e

    grep -E '^(SCREENSHOT|MISSED):' "$dest/xcodebuild.log" || true

    # Attachments are exported under UUID filenames; the manifest carries the
    # human names the harness set. Rename on the way out so the output
    # directory is browsable by a human filling in a listing.
    raw="$(mktemp -d)"
    xcrun xcresulttool export attachments --path "$result" --output-path "$raw" >/dev/null 2>&1 || true
    node -e '
        const fs = require("fs"), path = require("path");
        const [src, dst] = process.argv.slice(1);
        const manifest = path.join(src, "manifest.json");
        if (!fs.existsSync(manifest)) { console.log("  (no attachments exported)"); process.exit(0); }
        let n = 0;
        JSON.stringify(JSON.parse(fs.readFileSync(manifest, "utf8")), (k, v) => {
            const name = v && v.suggestedHumanReadableName;
            // Only the harness screenshots. XCUITest also attaches its own
            // "UI Snapshot" and "Synthesized Event" debris on failure, which
            // would bury the four images someone actually needs.
            if (name && /^\d\d-/.test(name) && v.exportedFileName) {
                const clean = name.replace(/_\d+_[0-9A-F-]{36}\.png$/i, "") + ".png";
                fs.copyFileSync(path.join(src, v.exportedFileName), path.join(dst, clean));
                console.log("  " + clean);
                n++;
            }
            return v;
        });
        if (!n) console.log("  (manifest held no harness screenshots)");
    ' "$raw" "$dest"
    rm -rf "$raw"

    if [ "$status" -ne 0 ]; then
        echo "  NOTE: the harness reported misses (see $dest/xcodebuild.log)."
        echo "  Screenshots for scenes it could not reach are named *-FAILED."
    fi
done

if [ "$capture_watches" = 1 ]; then
    for watch_case in "XC Watch 49mm:422:514" "XC Watch 41mm:352:430"; do
        IFS=: read -r watch_name watch_width watch_height <<< "$watch_case"
        pair_data="$(xcrun simctl list pairs -j | WATCH_NAME="$watch_name" node -e '
            const data = JSON.parse(require("fs").readFileSync(0));
            const matches = Object.entries(data.pairs || {}).filter(([, p]) =>
                p.watch?.name === process.env.WATCH_NAME && p.phone?.name === "XC iPhone 17");
            matches.sort(([a, x], [b, y]) => Number(y.state === "active") - Number(x.state === "active") || a.localeCompare(b));
            if (matches[0]) console.log([matches[0][0], matches[0][1].phone.udid, matches[0][1].watch.udid].join("\t"));
        ')"
        if [ -z "$pair_data" ]; then
            echo "screenshots: no XC iPhone 17 pair for '$watch_name'" >&2
            exit 1
        fi
        IFS=$'\t' read -r pair_id phone_udid watch_udid <<< "$pair_data"
        watch_slug="$(echo "$watch_name" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
        watch_dest="$outdir/$watch_slug"
        rm -rf "$watch_dest"; mkdir -p "$watch_dest"
        xcrun simctl pair_activate "$pair_id"
        xcrun simctl boot "$phone_udid" >/dev/null 2>&1 || true
        xcrun simctl boot "$watch_udid" >/dev/null 2>&1 || true
        xcrun simctl bootstatus "$phone_udid" -b >/dev/null
        xcrun simctl bootstatus "$watch_udid" -b >/dev/null
        xcrun simctl uninstall "$phone_udid" "$bundle_id" >/dev/null 2>&1 || true

        result="$(mktemp -d)/run.xcresult"
        xcodebuild test -project "$project" -scheme AppUITests -destination "id=$phone_udid" \
            -resultBundlePath "$result" -only-testing:AppUITests/ScreenshotTests/testCaptureListingScreenshots \
            > "$watch_dest/xcodebuild.log" 2>&1 &
        harness_pid=$!
        for scene in 01-balances 02-receive 03-send 04-settings; do
            while kill -0 "$harness_pid" 2>/dev/null && ! grep -Fq "SCREENSHOT: $scene" "$watch_dest/xcodebuild.log"; do sleep 1; done
            grep -Fq "SCREENSHOT: $scene" "$watch_dest/xcodebuild.log" || break
            xcrun simctl io "$watch_udid" screenshot "$watch_dest/$scene.png"
        done
        set +e; wait "$harness_pid"; status=$?; set -e
        if [ "$status" -ne 0 ]; then
            echo "screenshots: '$watch_name' phone onboarding failed; see $watch_dest/xcodebuild.log" >&2
            exit "$status"
        fi
        echo "screenshots: captured $watch_name at ${watch_width}x${watch_height}"
    done
fi

echo
echo "screenshots: wrote $outdir"
echo "Before these go in a listing: no real recovery phrase, no mainnet address holding real funds."

# Record WHICH BUILD these depict, in the same run that produced them.
#
# Until 2026-08-08 the images this script writes were `.gitignore`d and
# unpinned, so the eight live on the App Store listing existed on one disk, in
# no history, with nothing recording the tree they were shot from - and they
# turned out to depict a build 18 shared-UI commits older than the binary Apple
# holds, three of those commits changing what these very scenes render. Apple's
# 2.3.3 accurate-metadata rule makes that a rejection class. The pin is written
# HERE, rather than by hand afterwards, because a pin that was not written by a
# Capture is a claim about a capture nobody watched (row 63).
echo
echo "screenshots: pinning the set to $(git -C "$repo" rev-parse --short HEAD)"
node "$repo/tools/release/verify-listing-assets.mjs" --set ios --write --how capture
node --input-type=module - "$repo" "$outdir" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, outdir] = process.argv.slice(2);
const { pngHeader } = await import(pathToFileURL(join(repo, 'tools/release/verify-listing-assets.mjs')));
const pinPath = join(outdir, 'capture-pin.json');
const pin = JSON.parse(readFileSync(pinPath));
const cases = [['xc-watch-49mm', 422, 514], ['xc-watch-41mm', 352, 430]];
for (const [dir, width, height] of cases) {
    for (const scene of ['01-balances', '02-receive', '03-send', '04-settings']) {
        const name = `${dir}/${scene}.png`;
        const bytes = readFileSync(join(outdir, name));
        const header = pngHeader(bytes);
        if (!header || header.width !== width || header.height !== height || header.hasAlpha) {
            throw new Error(`${name}: expected opaque ${width}x${height} PNG, got ${JSON.stringify(header)}`);
        }
        pin.assets[name] = {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            width, height, shows: `${dir === 'xc-watch-49mm' ? 'Watch Ultra 4 49mm' : 'Watch Series 9 41mm'}: ${scene}`,
        };
    }
}
writeFileSync(pinPath, `${JSON.stringify(pin, null, 4)}\n`);
NODE

# Put the tree back the way it was found.
#
# This script stages a `store` bundle. Leaving it there means the next person
# to run `pnpm test:smoke` gets "the staged webDir is byte-identical to
# packages/web/dist" the moment anything rebuilds dist at `default`, and that
# failure names neither this script nor a profile. Taking screenshots should
# not change what the repo builds.
if [ "${KEEP_STORE_BUNDLE:-}" = "1" ]; then
    echo "screenshots: leaving the store bundle staged (KEEP_STORE_BUNDLE=1)"
else
    echo "screenshots: restoring the default-profile bundle"
    ( cd "$repo" && pnpm --filter @xchain-wallet/web build >/dev/null )
    ( cd "$repo" && pnpm --filter @xchain-wallet/mobile sync:ios >/dev/null )
fi
