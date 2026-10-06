#!/usr/bin/env bash
#
# Copyright © 2025-2026 Dankest, LLC
# Based on XChain Platform by Dankest, LLC - https://dankest.llc
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# This file is part of XChain Platform. Licensed under the GNU Affero
# General Public License v3.0 or later; see LICENSE.md. A commercial
# license (without AGPL source-disclosure terms) is available -
# contact legal@dankest.llc.
#

# tools/release/ci-keychain.sh - put signing identities into a dedicated
# keychain on a macOS runner, for electron-builder to use via CSC_KEYCHAIN.
#
# Usage:
#   bash tools/release/ci-keychain.sh <keychain-path> <P12_VAR>:<PASS_VAR> [...]
#
# Each pair names two ENVIRONMENT VARIABLES, never values: the first holds a
# base64 .p12 (what the MACOS_CSC_LINK style secrets carry), the second its
# passphrase. Nothing secret reaches argv or the log.
#
# WHY THIS EXISTS. Given CSC_LINK, app-builder-lib 26.15.7 builds its own
# temporary keychain with a random password and then runs
# `security set-key-partition-list -k <the .p12 passphrase>`, which is the
# wrong password for that keychain. On the macos-26 runner image that is a
# hard SecKeychainUnlock failure, and it ended the v0.341.0 mac lane before
# anything was signed. Reproduced on a throwaway certificate: the same call
# with the keychain's own password passes and codesign then finds the
# identity. So the import happens here, correctly, and the build steps hand
# electron-builder the finished keychain instead of the .p12.

set -euo pipefail

die() { echo "ci-keychain.sh: $*" >&2; exit 1; }

case "${1:-}" in
    --help|-h)
        awk 'NR > 13 && /^set -euo pipefail/ { exit } NR > 13 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
        exit 0 ;;
esac

[ "$(uname -s)" = Darwin ] || die "macOS only"
[ $# -ge 2 ] || die "usage: ci-keychain.sh <keychain-path> <P12_VAR>:<PASS_VAR> [...]"

KEYCHAIN="$1"
shift

# The keychain's own password: random, used only in this process, and the
# value set-key-partition-list must be given.
KC_PASS="$(openssl rand -hex 32)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

security create-keychain -p "$KC_PASS" "$KEYCHAIN"
# No -t: the default five-minute auto-lock would close the keychain during a
# notarization wait, between the app signature and the dmg signature.
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$KC_PASS" "$KEYCHAIN"

n=0
for pair in "$@"; do
    p12_var="${pair%%:*}"
    pass_var="${pair#*:}"
    [ "$p12_var" != "$pair" ] || die "'$pair' is not <P12_VAR>:<PASS_VAR>"
    p12_b64="${!p12_var:-}"
    pass="${!pass_var:-}"
    [ -n "${p12_b64//[[:space:]]/}" ] || die "$p12_var is empty"
    [ -n "$pass" ] || die "$pass_var is empty"
    n=$((n + 1))
    printf '%s' "$p12_b64" | base64 --decode > "$WORK/id$n.p12" \
        || die "$p12_var is not base64"
    security import "$WORK/id$n.p12" -k "$KEYCHAIN" -f pkcs12 -P "$pass" \
        -T /usr/bin/codesign -T /usr/bin/productbuild -T /usr/bin/security >/dev/null
    echo "ci-keychain.sh: imported $p12_var"
done

security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KEYCHAIN" >/dev/null

# On the user search list as well, so codesign and productbuild resolve the
# identity whichever way electron-builder asks.
existing="$(security list-keychains -d user | sed -e 's/^[[:space:]]*"//' -e 's/"$//')"
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN" $existing

count="$(security find-identity "$KEYCHAIN" | grep -oE "[0-9A-F]{40}" | sort -u | wc -l | tr -d " ")"
[ "$count" -ge "$n" ] || die "expected at least $n identities in $KEYCHAIN, found $count"
echo "ci-keychain.sh: $KEYCHAIN holds $count identit$( [ "$count" = 1 ] && echo y || echo ies)"
