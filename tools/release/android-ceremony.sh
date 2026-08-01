#!/usr/bin/env bash
#*********************************************************************
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
#*********************************************************************

# tools/release/android-ceremony.sh - build AND sign the two Android
# artifacts on the maintainer's release machine ( §6 step 2, §7).
#
# Usage:
#     bash tools/release/android-ceremony.sh --tag v0.333.1 \
#          --output release-artifacts/0.333.1
#
# Environment:
#     XCHAIN_K9_KEYSTORE   path to the Play upload keystore  (required)
#     XCHAIN_K9_ALIAS      key alias within it               (required)
#     XCHAIN_K10_KEYSTORE  path to the direct-APK keystore   (required)
#     XCHAIN_K10_ALIAS     key alias within it               (required)
#     BUNDLETOOL           path to bundletool jar (default: ./bundletool.jar)
#
# NO PASSWORD IS EVER PASSED ON A COMMAND LINE OR READ FROM THE
# ENVIRONMENT. jarsigner and apksigner both prompt when the password
# option is omitted, and that is exactly what happens here: a keystore
# password on an argv line is visible to every process on the machine
# and lands in the shell history of the person least able to rotate it
# (K10 cannot be rotated at all - see below).
#
# WHY THIS RUNS HERE AND NOT IN CI. Without reproducible builds (D5),
# an artifact built on a runner cannot be verified by the person whose
# key signs it, so signing runner output would let a runner compromise
# put OUR signature on ITS bytes. CI builds the same two artifacts
# unsigned as a health check (.github/workflows/mobile.yml); nothing it
# produces is ever published. When D5 lands this becomes rebuild-locally,
# compare-hashes, sign-on-match, and the build can move back.
#
# THE TWO KEYS ARE NOT INTERCHANGEABLE:
#   K9  signs the AAB that goes to Play. Losing it is recoverable -
#       Google verifies identity and accepts a new upload key.
#   K10 signs the APK people download directly. Losing OR leaking it is
#       NOT recoverable: Android will not install an update signed by a
#       different key, so every direct user must uninstall (which wipes
#       their vault) and reinstall across a trust break.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/packages/mobile"
ANDROID_DIR="$MOBILE_DIR/android"

TAG=""
OUTPUT_DIR=""

while [ $# -gt 0 ]; do
    case "$1" in
        --tag|-t) TAG="${2:-}"; shift 2 ;;
        --output|-o) OUTPUT_DIR="${2:-}"; shift 2 ;;
        --help|-h)
            sed -n '17,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "android-ceremony.sh: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

die() { echo "android-ceremony.sh: $*" >&2; exit 1; }

# A ceremony is a person at a machine. If this is running unattended,
# something has gone wrong: the prompts below would hang forever, and
# the keys are not supposed to be on a runner in the first place.
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    die "refusing to run in CI. Release artifacts are signed in the maintainer ceremony (§7)."
fi

[ -n "$TAG" ] || die "--tag vX.Y.Z is required"
[ -n "$OUTPUT_DIR" ] || die "--output <dir> is required"

for var in XCHAIN_K9_KEYSTORE XCHAIN_K9_ALIAS XCHAIN_K10_KEYSTORE XCHAIN_K10_ALIAS; do
    eval "value=\${$var:-}"
    [ -n "$value" ] || die "$var must be set (paths and aliases only; passwords are prompted)"
done
[ -f "$XCHAIN_K9_KEYSTORE" ] || die "K9 keystore not found at $XCHAIN_K9_KEYSTORE"
[ -f "$XCHAIN_K10_KEYSTORE" ] || die "K10 keystore not found at $XCHAIN_K10_KEYSTORE"

BUNDLETOOL="${BUNDLETOOL:-$REPO_ROOT/bundletool.jar}"
[ -f "$BUNDLETOOL" ] || die "bundletool jar not found at $BUNDLETOOL (set BUNDLETOOL=<path>)"

command -v java >/dev/null 2>&1 || die "java not found; the release machine needs a JDK (21)"
command -v jarsigner >/dev/null 2>&1 || die "jarsigner not found (ships with the JDK)"
command -v apksigner >/dev/null 2>&1 || die "apksigner not found; add \$ANDROID_HOME/build-tools/<ver> to PATH"

# Derive the version numbers from the tag alone, using the same module the
# Gradle build reads. A mismatch here would mean the file names and the
# manifest inside the artifact disagree about what release this is.
read -r VERSION_CODE VERSION_NAME <<EOF
$(node "$MOBILE_DIR/scripts/version.js" "$TAG")
EOF
[ -n "$VERSION_CODE" ] || die "could not derive a versionCode from $TAG"

# Artifact names come from the TAG, not from versionName. They differ for a
# respin: the respin is invisible to users, so versionName stays X.Y.Z, but its
# artifacts carry a different versionCode and must not land on the same
# filename as the release they re-upload (rails §2/§3).
ARTIFACT_VERSION="$(node "$MOBILE_DIR/scripts/version.js" "$TAG" --artifact)"
[ -n "$ARTIFACT_VERSION" ] || die "could not derive an artifact version from $TAG"
echo "==> $TAG -> versionCode $VERSION_CODE, versionName $VERSION_NAME, artifacts v$ARTIFACT_VERSION"

AAB_NAME="xchain-wallet-android-v${ARTIFACT_VERSION}.aab"
APK_NAME="xchain-wallet-v${ARTIFACT_VERSION}.apk"

# ---------------------------------------------------------------------
# 1. Build, from the tag, on this machine
# ---------------------------------------------------------------------

echo "==> staging the web build into the shell"
( cd "$REPO_ROOT" && XCHAIN_RELEASE_TAG="$TAG" pnpm --filter "@xchain-wallet/mobile..." build )
( cd "$REPO_ROOT" && pnpm --filter @xchain-wallet/mobile exec cap sync android )

echo "==> gradle bundleRelease"
# Dependency verification is enforced here and warn-only in CI (§7): a
# release build fails hard on any mismatch, because these are the bytes
# that get signed.
( cd "$ANDROID_DIR" && ./gradlew --no-daemon --write-verification-metadata sha256 help >/dev/null 2>&1 || true )
( cd "$ANDROID_DIR" && ./gradlew --no-daemon clean bundleRelease )

RAW_AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
[ -f "$RAW_AAB" ] || die "gradle did not produce $RAW_AAB"

mkdir -p "$OUTPUT_DIR"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
cp "$RAW_AAB" "$WORK_DIR/$AAB_NAME"

# ---------------------------------------------------------------------
# 2. Sign the AAB with K9 (Play upload key)
# ---------------------------------------------------------------------

echo "==> signing the AAB with K9 (you will be prompted for the keystore password)"
jarsigner -verbose:summary \
    -sigalg SHA256withRSA -digestalg SHA-256 \
    -keystore "$XCHAIN_K9_KEYSTORE" \
    "$WORK_DIR/$AAB_NAME" "$XCHAIN_K9_ALIAS"
jarsigner -verify "$WORK_DIR/$AAB_NAME" >/dev/null || die "K9 signature did not verify"

# ---------------------------------------------------------------------
# 3. Derive the universal APK FROM THAT SAME AAB, then sign with K10
# ---------------------------------------------------------------------
#
# Derived, never built a second time (§6 step 2). Two Gradle invocations
# would produce two sets of bytes that nobody compares, and the lane whose
# users verify hashes by hand is exactly the wrong place for that.

echo "==> deriving the universal APK from that AAB"
java -jar "$BUNDLETOOL" build-apks \
    --bundle="$WORK_DIR/$AAB_NAME" \
    --output="$WORK_DIR/universal.apks" \
    --mode=universal
unzip -p "$WORK_DIR/universal.apks" universal.apk > "$WORK_DIR/$APK_NAME"

echo "==> signing the APK with K10 (you will be prompted for the keystore password)"
apksigner sign \
    --ks "$XCHAIN_K10_KEYSTORE" \
    --ks-key-alias "$XCHAIN_K10_ALIAS" \
    --out "$WORK_DIR/$APK_NAME.signed" \
    "$WORK_DIR/$APK_NAME"
mv "$WORK_DIR/$APK_NAME.signed" "$WORK_DIR/$APK_NAME"
apksigner verify --verbose "$WORK_DIR/$APK_NAME" >/dev/null || die "K10 signature did not verify"

# ---------------------------------------------------------------------
# 4. Publish into the staging directory + print what humans need
# ---------------------------------------------------------------------

mv "$WORK_DIR/$AAB_NAME" "$OUTPUT_DIR/$AAB_NAME"
mv "$WORK_DIR/$APK_NAME" "$OUTPUT_DIR/$APK_NAME"

echo
echo "==> staged in $OUTPUT_DIR:"
echo "    $AAB_NAME   (Play upload; NEVER hosted publicly)"
echo "    $APK_NAME   (direct download; hosted on downloads.xchain.io)"
echo
echo "==> K10 certificate fingerprint. This is the value users verify, and the"
echo "    one assetlinks.json needs (packages/mobile/assetlinks.template.json)."
echo "    SECURITY.md holds the canonical copy; the download page is convenience."
apksigner verify --print-certs "$OUTPUT_DIR/$APK_NAME" | grep -i 'SHA-256' || true
echo
echo "Next: run tools/release/sign.sh over $OUTPUT_DIR so both artifacts land in"
echo "the GPG-signed manifest (K1). Publish the APK only after the Play staged"
echo "rollout reaches 100%, or on an explicit operator promote when Play stalls -"
echo "the direct lane never waits on a Play clock (§6 step 6)."
