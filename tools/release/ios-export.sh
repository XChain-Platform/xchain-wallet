#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Export the archived iOS shell to an .ipa ( §5, stage S4b).
#
# The artifact is NAMED here rather than wherever it lands, because rails
# §3 names it and expected-artifacts.txt matches on that name: an ipa
# called App.ipa is an undeclared file and hard-fails signing. The lane
# suffix is carried too (`-beta.N`, `-respin.N`), since a respin's ipa is
# different bytes under the same user-visible version.
#
# It exports and stops. Uploading to App Store Connect is a human step in
# v1 (rails no-auto-publish), and test/smoke/audits/release-ci.smoke.js
# fails the build if an upload ever appears in this repo's release path.
# If you are here to add one, change the rule first, deliberately, in the
# spec: the reason it exists is that a tag-triggered lane holding signing
# credentials plus an upload is a signed-malware factory.

set -euo pipefail

# Before the credential guards, for the reason ios-archive.sh states at the
# same position : `--help` answered with `APPLE_API_KEY ... is
# required` and exit 1 turns a question into a refusal.
case "${1:-}" in
    -h|--help)
        cat <<'USAGE'
ios-export.sh - export the archived iOS shell to a named .ipa ( §5).

Usage:
  XCHAIN_RELEASE_TAG=vX.Y.Z bash tools/release/ios-export.sh

Takes no arguments. Run ios-archive.sh first; this exports that archive and
stops. Uploading to App Store Connect is a human step in v1, and
test/smoke/audits/release-ci.smoke.js fails the build if an upload appears
in this repo's release path.

Environment (all required):
  XCHAIN_RELEASE_TAG  the release tag, e.g. v0.333.1 (must start with 'v')
  APPLE_API_KEY       App Store Connect API key, the .p8 file CONTENTS
  APPLE_API_KEY_ID    the key's id
  APPLE_API_ISSUER    the issuer id
  APPLE_TEAM_ID       the team the export is signed for

Output:
  packages/mobile/ios/build/xchain-wallet-ios-<tag>.ipa, plus its SHA-256.
  The name is fixed because expected-artifacts.txt matches on it.
USAGE
        exit 0
        ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
builddir="$here/packages/mobile/ios/build"
archive="$builddir/App.xcarchive"

: "${APPLE_API_KEY:?APPLE_API_KEY (the .p8 contents) is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"

tag="${XCHAIN_RELEASE_TAG:-}"
if [ -z "$tag" ]; then
    echo "ios-export: XCHAIN_RELEASE_TAG is required (e.g. v0.333.1)" >&2
    exit 1
fi
case "$tag" in
    v*) ;;
    *) echo "ios-export: tag '$tag' must start with 'v'" >&2; exit 1 ;;
esac

if [ ! -d "$archive" ]; then
    echo "ios-export: no archive at $archive; run ios-archive.sh first" >&2
    exit 1
fi

keydir="$(mktemp -d)"
trap 'rm -rf "$keydir"' EXIT
keyfile="$keydir/AuthKey_${APPLE_API_KEY_ID}.p8"
( umask 077; printf '%s' "$APPLE_API_KEY" > "$keyfile" )

# Generated rather than committed, because the only field that varies is
# the team id and that is a secret until enrollment completes. A committed
# plist with a placeholder team is a file someone eventually ships.
#
# uploadSymbols yes: without dSYMs, a crash report from a store build is
# unreadable. manageAppVersionAndBuildNumber NO: the version numbers come
# from Version.xcconfig and nothing else may rewrite them (S4a).
options="$keydir/ExportOptions.plist"
cat > "$options" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store-connect</string>
    <key>teamID</key><string>${APPLE_TEAM_ID}</string>
    <key>destination</key><string>export</string>
    <key>uploadSymbols</key><true/>
    <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

# Xcode's IPA-packaging step shells out to `rsync`, and it means APPLE'S rsync.
# A Homebrew rsync earlier on PATH (3.4.x tightened its argument parsing) rejects
# the invocation Xcode makes, and the whole export dies with a message that names
# neither rsync nor PATH:
#
#     error: exportArchive Copy failed
#     ** EXPORT FAILED **
#
# The real cause is only visible three logs deep, in IDEDistributionPipeline.log:
# "rsync error: syntax or usage error (code 1) at main.c(1806) [server=3.4.4]".
# Measured 2026-08-06 on the release Mac, where /opt/homebrew/bin/rsync 3.4.4
# shadows the system openrsync; the same export succeeds unchanged with the
# system one first. Pinned here rather than left to whoever's shell runs the
# lane, because this is a release script whose failure mode is a dead-end error
# on submission day. Prepending is deliberate: it does not remove anything from
# PATH, so every other tool the step calls resolves exactly as before.
export PATH="/usr/bin:$PATH"

xcodebuild -exportArchive \
    -archivePath "$archive" \
    -exportPath "$builddir/export" \
    -exportOptionsPlist "$options" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$keyfile" \
    -authenticationKeyID "$APPLE_API_KEY_ID" \
    -authenticationKeyIssuerID "$APPLE_API_ISSUER"

exported="$(find "$builddir/export" -maxdepth 1 -name '*.ipa' | head -1)"
if [ -z "$exported" ]; then
    echo "ios-export: export produced no .ipa" >&2
    exit 1
fi

target="$builddir/xchain-wallet-ios-${tag}.ipa"
mv "$exported" "$target"
echo "ios-export: wrote $(basename "$target")"

# Printed so the release machine's operator can match it against the
# manifest without opening the artifact. Not a signature and not a
# substitute for one: verify.sh is what proves the release.
shasum -a 256 "$target"
