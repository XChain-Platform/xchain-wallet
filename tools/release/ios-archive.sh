#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Archive the iOS shell for distribution (§5, stage S4b).
#
# Signing is CLOUD-MANAGED: rather than installing a distribution
# certificate and provisioning profile onto the runner, xcodebuild is
# handed the App Store Connect API key (K4) and told it may create what it
# needs. K5 therefore materializes on the runner transiently and is never
# stored as a repository secret.
#
# The tradeoff, stated because it is easy to forget once this works: a key
# that can mint certificates is a powerful credential. Scope it to the
# minimum role cloud signing accepts, and route Apple's
# certificate-issuance notification mail to a monitored inbox, so a
# certificate this lane creates cannot be created unnoticed by anyone else.
#
# This script archives. It does not export and it does not upload; those
# are separate steps for separate reasons (see ios-export.sh, and the
# no-publish rule the release-ci smoke enforces).

set -euo pipefail

# ANSWERED BEFORE THE CREDENTIAL CHECKS, and that ordering is the whole
# point. `--help` used to fall through to the `${APPLE_API_KEY:?}`
# guard below, so asking this script how to invoke it was answered with
#
#   ios-archive.sh: line 52: APPLE_API_KEY: APPLE_API_KEY (the .p8 contents)
#   is required, or set XCHAIN_IOS_ARCHIVE_UNSIGNED=1 ...
#
# and exit 1. That is the release lane's loudest refusal vocabulary aimed at
# someone who only asked for the usage, at the exact moment they asked
# because something else had already gone wrong. Help is not a build.
case "${1:-}" in
    -h|--help)
        cat <<'USAGE'
ios-archive.sh - archive the iOS shell for distribution (§5).

Usage:
  bash tools/release/ios-archive.sh              # signed, needs the API key
  XCHAIN_IOS_ARCHIVE_UNSIGNED=1 \
    bash tools/release/ios-archive.sh            # unsigned, no Apple account

Takes no arguments. Archives only: it does not export and it does not
upload (see ios-export.sh).

Environment, signed mode (all required):
  APPLE_API_KEY       App Store Connect API key, the .p8 file CONTENTS
  APPLE_API_KEY_ID    the key's id
  APPLE_API_ISSUER    the issuer id
  APPLE_TEAM_ID       the team the archive is signed for

Environment, unsigned mode:
  XCHAIN_IOS_ARCHIVE_UNSIGNED=1   archive with signing disabled

Unsigned proves the LANE, not the app: the result cannot be exported for
App Store distribution, and an unsigned build has no keychain-access-group,
so every vault call in it returns OSStatus -34018.

Prerequisite: pnpm --filter @xchain-wallet/mobile sync:ios
USAGE
        exit 0
        ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project="$here/packages/mobile/ios/App/App.xcodeproj"
archive="$here/packages/mobile/ios/build/App.xcarchive"

# UNSIGNED MODE, and why a release script has one (row 22).
#
# Everything below was gated behind an Apple Developer Program account that
# does not exist yet, so this script had NEVER RUN ONCE - and the day it first
# runs would have been submission day, with a store deadline on it. That is the
# same shape as the two orphan lane scripts (§14b) and the pbxproj input that
# was never committed: a thing believed to work because nothing had disproved
# it.
#
# Most of what this script does needs no Apple account at all. `xcodebuild
# archive` with signing disabled still exercises the scheme, the Release
# configuration, the `generic/platform=iOS` destination, the archive action,
# the Version.xcconfig wiring and this script's own preflight - the whole path
# except the credential-bearing flags. So that half is runnable today, and is.
#
# WHAT AN UNSIGNED ARCHIVE CANNOT TELL YOU, stated here so a green run is not
# read as more than it is: it cannot be exported for App Store distribution
# (ios-export.sh needs K5), and an unsigned app has no keychain-access-group,
# so every vault call in anything built this way returns OSStatus -34018. This
# mode proves the LANE. Only a device or TestFlight build proves the app.
unsigned="${XCHAIN_IOS_ARCHIVE_UNSIGNED:-}"

if [ -z "$unsigned" ]; then
    : "${APPLE_API_KEY:?APPLE_API_KEY (the .p8 contents) is required, or set XCHAIN_IOS_ARCHIVE_UNSIGNED=1 to archive without signing}"
    : "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
    : "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
    : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
fi

if [ ! -d "$project" ]; then
    echo "ios-archive: no Xcode project at $project" >&2
    echo "Run 'pnpm --filter @xchain-wallet/mobile sync:ios' first." >&2
    exit 1
fi

# The project reads its version numbers ONLY from this generated file
# (S4a); the pbxproj carries no literal to fall back to. If staging did
# not run, the build would either fail or, worse, succeed against a stale
# file and upload a version number that is already spent for the life of
# the app.
if [ ! -f "$here/packages/mobile/ios/App/Version.xcconfig" ]; then
    echo "ios-archive: Version.xcconfig is missing; sync:ios did not run" >&2
    exit 1
fi

rm -rf "$archive"

if [ -n "$unsigned" ]; then
    echo "ios-archive: UNSIGNED archive - proves the lane, not the app. Not exportable." >&2
    # DEVELOPMENT_TEAM and CODE_SIGN_ENTITLEMENTS are cleared as well as the
    # identity: the project sets both, and leaving either in place makes
    # xcodebuild look for a provisioning profile it cannot have and fail on
    # exactly the credential this mode exists to do without.
    xcodebuild archive \
        -project "$project" \
        -scheme App \
        -configuration Release \
        -destination 'generic/platform=iOS' \
        -archivePath "$archive" \
        CODE_SIGNING_ALLOWED=NO \
        CODE_SIGNING_REQUIRED=NO \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGN_ENTITLEMENTS="" \
        DEVELOPMENT_TEAM=""
else
    # xcodebuild wants the key as a FILE. Written with a restrictive umask and
    # never echoed: the value is passed through the environment into the file
    # directly, so it does not appear in an argument list, in the run log, or
    # in any shell history.
    keydir="$(mktemp -d)"
    trap 'rm -rf "$keydir"' EXIT
    keyfile="$keydir/AuthKey_${APPLE_API_KEY_ID}.p8"
    ( umask 077; printf '%s' "$APPLE_API_KEY" > "$keyfile" )

    xcodebuild archive \
        -project "$project" \
        -scheme App \
        -configuration Release \
        -destination 'generic/platform=iOS' \
        -archivePath "$archive" \
        -allowProvisioningUpdates \
        -authenticationKeyPath "$keyfile" \
        -authenticationKeyID "$APPLE_API_KEY_ID" \
        -authenticationKeyIssuerID "$APPLE_API_ISSUER" \
        DEVELOPMENT_TEAM="$APPLE_TEAM_ID"
fi

# Assert the archive is REALLY there and carries an app, rather than trusting
# xcodebuild's exit code. `archive` can succeed having written a bundle with no
# application inside it when the scheme's archive action is misconfigured, and
# that is precisely the kind of thing this script existing-but-never-running
# left unknown.
app="$archive/Products/Applications/App.app"
if [ ! -d "$app" ]; then
    echo "ios-archive: xcodebuild succeeded but $app is not there" >&2
    exit 1
fi

# And what is INSIDE it. Until this, the only fact this script
# established about the thing it built was that a directory of the right name
# existed: not the bundle id, not the version pair, not the Universal Link
# entitlement the signature actually carries. That is the state the Android
# bundle was in.
#
# It runs here rather than only before export so a defect is attributed to the
# archive that carries it. ios-export.sh checks the archive again before
# exporting, because by then the answer decides whether an artifact exists at
# all, and checks the ipa afterwards for the facts only a signed export has.
verify_args=(--stage archive)
if [ -n "$unsigned" ]; then
    verify_args+=(--unsigned)
else
    # The team this script asked for above, handed to the verifier so the
    # SIGNATURE is held against the request. Cloud signing picks the profile and
    # the profile's team is the portal's answer, so DEVELOPMENT_TEAM is a
    # request and not a guarantee. Only in the signed lane: the unsigned archive
    # carries no entitlements to compare, and APPLE_TEAM_ID is not required
    # there.
    verify_args+=(--team-id "$APPLE_TEAM_ID")
fi
if ! node "$here/tools/release/verify-ios-artifact.mjs" "$app" "${verify_args[@]}"; then
    echo "ios-archive: the archive does not carry what the project pins; it is not exportable" >&2
    exit 1
fi

echo "ios-archive: wrote $archive"
