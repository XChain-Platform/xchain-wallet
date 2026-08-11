#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# App Store screenshot harness driver ( §6, ).
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
else
    devices=("iPhone 17 Pro Max" "iPad Pro 13-inch (M5)")
fi

if [ ! -d "$project" ]; then
    echo "screenshots: no Xcode project at $project" >&2
    echo "Run 'pnpm --filter @xchain-wallet/mobile sync:ios' first." >&2
    exit 1
fi

# The listing must show the app users actually get, which is the `store`
# profile: a `default` build carries the §2.3 review-hidden surfaces, and a
# screenshot of a surface the shipped app does not have is a rejection all by
# itself.
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
stamp="$pkg/www/build-profile.txt"
if [ ! -f "$stamp" ]; then
    echo "screenshots: no build-profile stamp at $stamp; the bundle was never staged" >&2
    exit 1
fi
profile="$(tr -d '[:space:]' < "$stamp")"
if [ "$profile" != "store" ]; then
    echo "screenshots: staged bundle is profile '$profile', refusing to shoot a listing set." >&2
    echo "  A '$profile' build carries the review-hidden surfaces ( §2.3)." >&2
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

    udid="$(xcrun simctl list devices available | grep -F "$device (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
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
# capture is a claim about a capture nobody watched (,  row 63).
echo
echo "screenshots: pinning the set to $(git -C "$repo" rev-parse --short HEAD)"
node "$repo/tools/release/verify-listing-assets.mjs" --set ios --write --how capture

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
