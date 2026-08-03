#!/usr/bin/env bash
# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Archive the iOS shell for distribution ( §5, stage S4b).
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

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project="$here/packages/mobile/ios/App/App.xcodeproj"
archive="$here/packages/mobile/ios/build/App.xcarchive"

: "${APPLE_API_KEY:?APPLE_API_KEY (the .p8 contents) is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"

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

# xcodebuild wants the key as a FILE. Written with a restrictive umask and
# never echoed: the value is passed through the environment into the file
# directly, so it does not appear in an argument list, in the run log, or
# in any shell history.
keydir="$(mktemp -d)"
trap 'rm -rf "$keydir"' EXIT
keyfile="$keydir/AuthKey_${APPLE_API_KEY_ID}.p8"
( umask 077; printf '%s' "$APPLE_API_KEY" > "$keyfile" )

rm -rf "$archive"

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

echo "ios-archive: wrote $archive"
