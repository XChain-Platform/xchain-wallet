#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Export the archived iOS shell to an .ipa (§5, stage S4b).
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
# same position: `--help` answered with `APPLE_API_KEY ... is
# required` and exit 1 turns a question into a refusal.
case "${1:-}" in
    -h|--help)
        cat <<'USAGE'
ios-export.sh - export the archived iOS shell to a named .ipa (§5).

Usage:
  XCHAIN_RELEASE_TAG=vX.Y.Z bash tools/release/ios-export.sh

Takes no arguments. Run ios-archive.sh first; this exports that archive and
stops. Uploading to App Store Connect is a human step in v1, and
test/smoke/audits/release-ci.smoke.js fails the build if an upload appears
in this repo's release path.

Environment (all required):
  XCHAIN_RELEASE_TAG  the release tag, e.g. v0.333.1 (must start with 'v')
  APPLE_API_KEY       App Store Connect API key, the .p8 file CONTENTS, or set
  APPLE_API_KEY_PATH  the path to the .p8 file instead
  APPLE_API_KEY_ID    the key's id
  APPLE_API_ISSUER    the issuer id
  APPLE_TEAM_ID       the team the export is signed for

When neither key variable is set, the single AuthKey_*.p8 under
APPLE_API_KEY_DIR (default: ~/.appstoreconnect/private_keys) is used. The
issuer defaults to XCHAIN_RELEASE_DIR/asc-issuer.txt and the team defaults to
the Xcode project's DEVELOPMENT_TEAM.

Optional:
  XCHAIN_AASA         the published apple-app-site-association, as a path or an
                      https URL, so the signed appID is held against what
                      devices are told. Defaults to the sibling xchain-websites
                      checkout when one is beside this repo; with neither, the
                      verifier reports the appID as UNCHECKED

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
project="$here/packages/mobile/ios/App/App.xcodeproj"

keyfile="${APPLE_API_KEY_PATH:-}"
if [ -n "$keyfile" ]; then
    if [ ! -f "$keyfile" ]; then
        echo "ios-export: APPLE_API_KEY_PATH does not exist: $keyfile" >&2
        exit 1
    fi
elif [ -z "${APPLE_API_KEY:-}" ]; then
    key_search_dir="${APPLE_API_KEY_DIR:-$HOME/.appstoreconnect/private_keys}"
    key_matches=()
    for candidate in "$key_search_dir"/AuthKey_*.p8; do
        [ -f "$candidate" ] && key_matches+=("$candidate")
    done
    if [ "${#key_matches[@]}" -ne 1 ]; then
        echo "ios-export: expected exactly one AuthKey_*.p8 in $key_search_dir; found ${#key_matches[@]}" >&2
        exit 1
    fi
    keyfile="${key_matches[0]}"
    key_name="$(basename "$keyfile")"
    APPLE_API_KEY_ID="${key_name#AuthKey_}"
    APPLE_API_KEY_ID="${APPLE_API_KEY_ID%.p8}"
fi
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
if [ -z "${APPLE_API_ISSUER:-}" ]; then
    issuer_file="${XCHAIN_RELEASE_DIR:-$HOME/.xchain-release}/asc-issuer.txt"
    if [ ! -f "$issuer_file" ]; then
        echo "ios-export: APPLE_API_ISSUER is unset and $issuer_file does not exist" >&2
        exit 1
    fi
    APPLE_API_ISSUER="$(<"$issuer_file")"
fi
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required or asc-issuer.txt must be non-empty}"
if [ -z "${APPLE_TEAM_ID:-}" ] && [ -f "$project/project.pbxproj" ]; then
    APPLE_TEAM_ID="$(awk '/DEVELOPMENT_TEAM = [^;]+;/ { value=$0; sub(/^.*DEVELOPMENT_TEAM = /, "", value); sub(/;.*/, "", value); print value; exit }' "$project/project.pbxproj")"
fi
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required or the Xcode project must set DEVELOPMENT_TEAM}"
if [ -n "$keyfile" ]; then
    echo "ios-export: using App Store Connect key file $keyfile (key ID $APPLE_API_KEY_ID)" >&2
fi

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

# REFUSE TO EXPORT AN ARCHIVE THAT DOES NOT CARRY WHAT THE PROJECT PINS.
# The archive on disk need not be the one this tag's ios-archive.sh
# wrote: it is whatever is at that path, and the path is stable across runs. So
# the version pair is checked against the TAG here rather than only against
# Version.xcconfig, which is what catches yesterday's archive being exported
# under today's tag - a case where the archive is internally consistent and
# every file in the repo is correct.
#
# Before the key file is written, so an archive that fails is refused without
# the App Store Connect credential ever materialising on disk.
#
# --aasa resolves exactly as it does in ios-archive.sh, and that script states
# why: the published association is the only authority for the Team ID that is
# not another copy of $APPLE_TEAM_ID, and it lives in the sibling repo this
# repo's CI does not check out. It is passed to BOTH verifications below,
# because the export re-signs and the team can change in the re-signing.
aasa="${XCHAIN_AASA:-}"
if [ -z "$aasa" ] && [ -f "$here/../xchain-websites/xchain.io/.well-known/apple-app-site-association" ]; then
    aasa="$here/../xchain-websites/xchain.io/.well-known/apple-app-site-association"
fi
# Seeded non-empty because `set -u` makes an empty array expansion an error on
# the bash 3.2 that ships with macOS, which is the only platform this runs on.
verify_args=(--tag "$tag" --team-id "$APPLE_TEAM_ID")
if [ -n "$aasa" ]; then
    verify_args+=(--aasa "$aasa")
fi

if ! node "$here/tools/release/watch-embed.mjs" "$archive"; then
    echo "ios-export: the archive is missing its watch app or widget extension; nothing was exported" >&2
    exit 1
fi

if ! node "$here/tools/release/verify-ios-artifact.mjs" \
        "$archive/Products/Applications/App.app" --stage archive "${verify_args[@]}"; then
    echo "ios-export: the archive does not carry what the project pins; nothing was exported" >&2
    exit 1
fi

keydir="$(mktemp -d)"
trap 'rm -rf "$keydir"' EXIT
if [ -z "$keyfile" ]; then
    keyfile="$keydir/AuthKey_${APPLE_API_KEY_ID}.p8"
    ( umask 077; printf '%s' "$APPLE_API_KEY" > "$keyfile" )
    echo "ios-export: using App Store Connect key file $keyfile (key ID $APPLE_API_KEY_ID)" >&2
fi

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
#
# DO NOT "FIX" THIS BY REMOVING THE HOMEBREW RSYNC. The desktop/web publish lane
# REQUIRES it: publish.sh refuses openrsync outright, because a forced-command
# rrsync feed rejects the `--dirs` long option openrsync sends. The two lanes
# need opposite rsyncs on the same machine, so the release Mac carries both and
# each lane picks its own - this one by PATH, publish.sh by absolute path, which
# is why that script is immune to the line below.
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

# The export re-signs, so three facts exist only here and could not have been
# checked on the archive: whether the identity Xcode chose is a DISTRIBUTION one
# (a development profile carries a device list and installs on those UDIDs and
# nowhere else), whether `get-task-allow` survived into the shipped binary, and
# whether the zip holds exactly one app. Cloud signing chooses the identity, so
# these are not decisions any file in this repo records.
#
# A failure RENAMES rather than deletes. The bytes are the evidence for
# whatever went wrong, and cloud signing means reproducing them costs another
# round trip to Apple; but a signed ipa left under its declared name is a file
# somebody later finds on a disk and trusts, and it is the name that
# expected-artifacts.txt and sign.sh match on. The suffix takes it out of every
# glob that would pick it up.
if ! node "$here/tools/release/watch-embed.mjs" "$target" ||
        ! node "$here/tools/release/verify-ios-artifact.mjs" "$target" --stage export "${verify_args[@]}"; then
    mv "$target" "$target.rejected"
    echo "ios-export: the exported ipa is not distributable; kept as $(basename "$target").rejected" >&2
    exit 1
fi

echo "ios-export: wrote $(basename "$target")"

# Printed so the release machine's operator can match it against the
# manifest without opening the artifact. Not a signature and not a
# substitute for one: verify.sh is what proves the release.
shasum -a 256 "$target"
