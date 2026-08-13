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

# tools/release/android-applinks-verify.sh - take the App Links verdict
# for `xchain.io` as a REPEATABLE measurement instead of a session that
# has to be rediscovered every time.
#
# WHY THIS EXISTS. App Links fail SILENTLY: an install whose certificate
# is not in `https://xchain.io/.well-known/assetlinks.json` simply opens
# every `xchain.io` link in the browser, forever, with no error anywhere.
# The only thing that settles it is Android's own verifier answering
# `verified`, and getting that answer took most of two sessions because
# three separate venue facts each look like a result and are not:
#
#   `google_apis` images        The domain-verification agent is on the
#                               image (other packages read `verified`)
#                               and is NEVER INVOKED for a sideloaded
#                               package. The domain sits at `none`
#                               through a reset, two re-verifies and
#                               sixty seconds of polling, with zero
#                               verification activity in logcat.
#                               `none` is the ABSENCE of a verdict, so
#                               it proves neither pass nor fail - and
#                               read as a fail it sends someone to
#                               re-deploy an assetlinks.json that was
#                               already right.
#
#   API 30 and below            `pm get-app-links`, `pm verify-app-links`
#                               and `pm set-app-links` do not exist
#                               (`Unknown command`); the Domain
#                               Verification API arrived in API 31. The
#                               near-miss SINGULAR `pm get-app-link`
#                               DOES exist there and is a trap: it
#                               returns `always/ask/never/undefined`,
#                               which is a user link-handling
#                               PREFERENCE, not a verdict. Reading
#                               `always` off it and recording it as
#                               `verified` is the exact error that
#                               invalidated this project's first
#                               measurement.
#
#   A cached verdict            A `verified` that appears whether or not
#                               the live file is reachable measures
#                               nothing. `--falsify` proves the reading
#                               is contingent on actually fetching
#                               `xchain.io/.well-known/assetlinks.json`,
#                               by taking the device offline and
#                               requiring the verdict to STOP being
#                               `verified` (it lands on `1024`,
#                               STATE_FIRST_VERIFIER_DEFINED, the
#                               agent's error state) and then come back
#                               when the network does.
#
# So the venue is `google_apis_playstore`, API 31+, and this script
# provisions it, installs the artifact, resets and re-verifies, polls for
# a real verdict, and refuses loudly wherever the answer would not mean
# what it says.
#
# WHAT IT DELIBERATELY DOES NOT DO. It measures the certificate the
# INSTALLED ARTIFACT carries, and prints that fingerprint every run for
# exactly that reason. Google's CURRENT app-signing certificate reaches a
# device only through a real Play delivery, and the console's own
# `Signed, universal APK` download was measured carrying the RETIRED key
# while looking like it carried the live one. That last step - opt the
# tester account into the internal track, install from Play, run this
# script with `--no-provision --no-install` against that install - stays
# manual, because it is a Google sign-in and not an engineering step.
#
# Every input is overridable, so the whole decision table is drivable by
# a test with no emulator present:
#
#   XCHAIN_ANDROID_SDK          SDK root (default the Homebrew cmdline-tools)
#   XCHAIN_ADB                  path to adb
#   XCHAIN_SDKMANAGER           path to sdkmanager
#   XCHAIN_AVDMANAGER           path to avdmanager
#   XCHAIN_EMULATOR             path to emulator
#   XCHAIN_APKSIGNER            path to apksigner
#   XCHAIN_AVD_HOME             where AVD config.ini files live
#   XCHAIN_APPLINKS_AVD         AVD name             (default xc36play)
#   XCHAIN_APPLINKS_IMAGE       system image package
#   XCHAIN_APPLINKS_DEVICE      device profile       (default pixel_6)
#   XCHAIN_APPLINKS_PACKAGE     applicationId        (default io.xchain.wallet.android)
#   XCHAIN_APPLINKS_DOMAIN      domain to verify     (default xchain.io)
#   XCHAIN_APPLINKS_APK         artifact to install
#   XCHAIN_APPLINKS_PORT        emulator port        (default 5560)
#   XCHAIN_APPLINKS_SERIAL      adb serial           (default emulator-$PORT)
#   XCHAIN_APPLINKS_TIMEOUT     seconds to poll for a verdict (default 120)
#   XCHAIN_APPLINKS_POLL        seconds between polls (default 10)
#   XCHAIN_APPLINKS_BOOT_TIMEOUT seconds to wait for boot (default 300)
#
# Exit codes:
#   0  the domain reads `verified` (and, with --falsify, is contingent)
#   2  caller error
#   3  this venue cannot answer the question - refused before or after
#      spending the time, never folded into a pass or a fail
#   4  the poll ended at `none`: no verdict was ever attempted
#   5  a real, stated, non-verified verdict
#   6  a missing tool, artifact or environment
#   7  the verdict is NOT contingent on the live file (--falsify)

set -euo pipefail

say()  { echo "[applinks] $*"; }
warn() { echo "[applinks] $*" >&2; }

die() {
    local code="$1"; shift
    warn "REFUSING: $*"
    exit "${code}"
}

usage() {
    cat <<'USAGE'
android-applinks-verify.sh - is `xchain.io` actually App-Links verified
for this build, measured by Android's own verifier?

Usage:
  bash tools/release/android-applinks-verify.sh [options]

Options:
  --apk <path>     artifact to install (default: the newest
                   release-artifacts/*/xchain-wallet-v*.apk)
  --no-provision   use whatever device is already attached; do not
                   install a system image, create an AVD or boot one
  --no-install     do not install the artifact (use for a Play-delivered
                   install, which is the one thing this cannot stage)
  --keep-running   leave the emulator running when done
  --falsify        additionally prove the verdict is contingent on the
                   live assetlinks.json, by taking the device offline
                   and requiring the verdict to change
  --json           print a one-line JSON summary as the last line
  -h, --help       this

Exit codes:
  0 verified   2 caller error   3 venue cannot answer   4 no verdict
  5 a stated non-verified verdict   6 missing tool/artifact   7 not contingent

The one step this does NOT automate: an install carrying Google's CURRENT
Play app-signing certificate. That reaches a device only through a real
Play delivery to a tester account, so run that install by hand and then
point this script at it with --no-provision --no-install.
USAGE
}

# ---------------------------------------------------------------- inputs

APK=""
DO_PROVISION=1
DO_INSTALL=1
KEEP_RUNNING=0
FALSIFY=0
JSON=0

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)      usage; exit 0 ;;
        --apk)          APK="${2:-}"; [ -n "${APK}" ] || die 2 "--apk needs a path"; shift 2 ;;
        --apk=*)        APK="${1#--apk=}"; shift ;;
        --no-provision) DO_PROVISION=0; shift ;;
        --no-install)   DO_INSTALL=0; shift ;;
        --keep-running) KEEP_RUNNING=1; shift ;;
        --falsify)      FALSIFY=1; shift ;;
        --json)         JSON=1; shift ;;
        # A consumed flag is worse than a rejected one: a sibling tool in
        # this directory took `--help` as its one positional, ran the whole
        # job against a target literally named `--help`, and exited 0.
        *)              warn "unknown argument '$1'"; warn "try --help"; exit 2 ;;
    esac
done

SDK_ROOT="${XCHAIN_ANDROID_SDK:-/opt/homebrew/share/android-commandlinetools}"
ADB="${XCHAIN_ADB:-${SDK_ROOT}/platform-tools/adb}"
SDKMANAGER="${XCHAIN_SDKMANAGER:-${SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager}"
AVDMANAGER="${XCHAIN_AVDMANAGER:-${SDK_ROOT}/cmdline-tools/latest/bin/avdmanager}"
EMULATOR="${XCHAIN_EMULATOR:-${SDK_ROOT}/emulator/emulator}"
APKSIGNER="${XCHAIN_APKSIGNER:-}"
AVD_HOME="${XCHAIN_AVD_HOME:-${ANDROID_AVD_HOME:-${HOME}/.android/avd}}"

AVD="${XCHAIN_APPLINKS_AVD:-xc36play}"
IMAGE="${XCHAIN_APPLINKS_IMAGE:-system-images;android-36;google_apis_playstore;arm64-v8a}"
DEVICE="${XCHAIN_APPLINKS_DEVICE:-pixel_6}"
PKG="${XCHAIN_APPLINKS_PACKAGE:-io.xchain.wallet.android}"
DOMAIN="${XCHAIN_APPLINKS_DOMAIN:-xchain.io}"
PORT="${XCHAIN_APPLINKS_PORT:-5560}"
SERIAL="${XCHAIN_APPLINKS_SERIAL:-emulator-${PORT}}"
TIMEOUT="${XCHAIN_APPLINKS_TIMEOUT:-120}"
POLL="${XCHAIN_APPLINKS_POLL:-10}"
BOOT_TIMEOUT="${XCHAIN_APPLINKS_BOOT_TIMEOUT:-300}"

# A zero poll interval never advances the elapsed counter, so the poll loop
# would run forever on a domain that stays at `none` - which is the single
# most likely outcome on the wrong image.
[ "${POLL}" -ge 1 ] 2>/dev/null || POLL=1

# The Domain Verification API landed in API 31. Below it the three
# commands this script drives do not exist at all.
MIN_SDK=31

here="$(cd "$(dirname "$0")" && pwd)"
WS_ROOT="$(cd "${here}/../.." && pwd)"

adbsh() { "${ADB}" -s "${SERIAL}" shell "$@"; }

# Both SDK tools may prompt (a licence, a custom hardware profile), so both
# are fed an answer. `set -o pipefail` is what makes this a function rather
# than a pipe written inline: the feeder gets SIGPIPE when the tool exits
# without draining stdin, and pipefail then reports the pipeline as 141 -
# an install that SUCCEEDED, read as a failure.
feed_stdin_to() {
    local answer="$1"; shift
    local rc
    set +o pipefail
    yes "${answer}" 2>/dev/null | "$@" >/dev/null
    rc="${PIPESTATUS[1]}"
    set -o pipefail
    return "${rc}"
}

# --------------------------------------------------------------- the AVD

# The image string is checked BEFORE anything is installed or booted,
# because `google_apis` is the wrong venue by construction and the way it
# fails (a permanent `none`) costs a full session to diagnose.
assert_playstore_image_string() {
    case "${IMAGE}" in
        *google_apis_playstore*) return 0 ;;
    esac
    warn "REFUSING: the system image '${IMAGE}' is not a google_apis_playstore image."
    warn "A google_apis image carries the domain-verification agent but never runs it for"
    warn "a sideloaded package: the domain stays at 'none' through a reset, repeated"
    warn "'pm verify-app-links --re-verify' and minutes of polling, with no verification"
    warn "activity in logcat at all. 'none' is the ABSENCE of a verdict, so a run on that"
    warn "image cannot answer this question in either direction."
    warn "Use: system-images;android-<api>;google_apis_playstore;<abi>"
    exit 3
}

# And checked AGAIN against the AVD that will actually boot, since the AVD
# may pre-date this script or have been created from the other image with
# the same name. `tag.id` is the authority here; `PlayStore.enabled` is
# NOT - it reads `no` on a perfectly good google_apis_playstore AVD whose
# device profile is not Play-capable, and that AVD verifies fine.
assert_avd_image() {
    local cfg="${AVD_HOME}/${AVD}.avd/config.ini"
    [ -f "${cfg}" ] || die 6 "no AVD config at ${cfg}; provisioning did not produce '${AVD}'"

    local tag sysdir
    tag="$(sed -n 's/^tag\.id=//p' "${cfg}" | head -n1)"
    sysdir="$(sed -n 's/^image\.sysdir\.1=//p' "${cfg}" | head -n1)"

    case "${tag}:${sysdir}" in
        *google_apis_playstore*) say "AVD '${AVD}' is a Google Play image (tag.id=${tag})" ;;
        *)
            warn "REFUSING: AVD '${AVD}' was created from '${tag:-unknown}' (${sysdir:-unknown})."
            warn "Only a google_apis_playstore image runs the domain-verification agent for a"
            warn "sideloaded package. On a google_apis image the domain never leaves 'none',"
            warn "which is an ABSENCE of a verdict and must not be read as pass or fail."
            warn "Delete it and re-run: ${AVDMANAGER} delete avd -n ${AVD}"
            exit 3
            ;;
    esac
}

provision() {
    [ -x "${SDKMANAGER}" ]  || die 6 "no sdkmanager at ${SDKMANAGER} (set XCHAIN_ANDROID_SDK or XCHAIN_SDKMANAGER)"
    [ -x "${AVDMANAGER}" ]  || die 6 "no avdmanager at ${AVDMANAGER} (set XCHAIN_ANDROID_SDK or XCHAIN_AVDMANAGER)"
    [ -x "${EMULATOR}" ]    || die 6 "no emulator at ${EMULATOR} (set XCHAIN_ANDROID_SDK or XCHAIN_EMULATOR)"

    # Both SDK tools are Java programs that report "Unable to locate a Java
    # Runtime" rather than anything about JAVA_HOME when it is unset, which
    # reads as a broken SDK.
    if [ -z "${JAVA_HOME:-}" ]; then
        if [ -d /opt/homebrew/opt/openjdk@21 ]; then
            export JAVA_HOME=/opt/homebrew/opt/openjdk@21
            say "JAVA_HOME was unset; using ${JAVA_HOME}"
        else
            die 6 "JAVA_HOME is unset and no JDK was found; sdkmanager/avdmanager will say 'Unable to locate a Java Runtime'"
        fi
    fi

    say "installing system image ${IMAGE} (no-op if present)"
    feed_stdin_to 'y' "${SDKMANAGER}" --install "${IMAGE}" \
        || die 6 "sdkmanager could not install ${IMAGE}"

    if "${AVDMANAGER}" list avd 2>/dev/null | grep -q "Name: ${AVD}\$"; then
        say "AVD '${AVD}' already exists"
    else
        say "creating AVD '${AVD}' from ${IMAGE} on device profile ${DEVICE}"
        feed_stdin_to 'no' "${AVDMANAGER}" create avd -n "${AVD}" -k "${IMAGE}" -d "${DEVICE}" \
            || die 6 "avdmanager could not create AVD '${AVD}'"
    fi
}

boot() {
    if "${ADB}" -s "${SERIAL}" get-state 2>/dev/null | grep -q '^device$'; then
        say "${SERIAL} is already attached; not booting a second one"
        return 0
    fi

    say "booting ${AVD} on port ${PORT}"
    "${EMULATOR}" -avd "${AVD}" -port "${PORT}" -no-window -no-audio -no-boot-anim \
        -gpu swiftshader_indirect >/dev/null 2>&1 &

    local waited=0
    while [ "${waited}" -lt "${BOOT_TIMEOUT}" ]; do
        if [ "$("${ADB}" -s "${SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ]; then
            say "booted after ${waited}s"
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
    done
    die 6 "${SERIAL} did not finish booting within ${BOOT_TIMEOUT}s"
}

# ------------------------------------------------------------ the device

assert_device_can_answer() {
    local sdk
    sdk="$(adbsh getprop ro.build.version.sdk 2>/dev/null | tr -d '\r\n')"
    [ -n "${sdk}" ] || die 6 "no device at ${SERIAL} (adb reported nothing for ro.build.version.sdk)"

    if [ "${sdk}" -lt "${MIN_SDK}" ] 2>/dev/null; then
        warn "REFUSING: ${SERIAL} reports API ${sdk}; the Domain Verification API is API ${MIN_SDK}+."
        warn "'pm get-app-links', 'pm verify-app-links' and 'pm set-app-links' are all"
        warn "'Unknown command' below that, and a full 'dumpsys package' sweep contains no"
        warn "verification-status line at all. The SINGULAR 'pm get-app-link' does exist and"
        warn "is a TRAP: it returns always/ask/never/undefined, which is the user's link"
        warn "handling PREFERENCE, not a verdict. Reading 'always' off it as 'verified' is"
        warn "the exact mistake that invalidated this project's first measurement."
        exit 3
    fi
    say "${SERIAL} reports API ${sdk}"

    # The Play Store package is the marker that this really is a
    # google_apis_playstore image, whatever the AVD is named. It is what
    # separates an image whose verification agent runs on demand for a
    # sideloaded package from one whose agent is present and never invoked.
    if ! adbsh pm path com.android.vending >/dev/null 2>&1; then
        warn "REFUSING: ${SERIAL} has no com.android.vending, so it is not a Play image."
        warn "On a google_apis image the verification agent is present (other packages read"
        warn "'verified') and is never invoked for a sideloaded package: the domain holds at"
        warn "'none' indefinitely, which proves neither pass nor fail."
        exit 3
    fi
    say "com.android.vending present: this is a Play image"
}

install_artifact() {
    [ -f "${APK}" ] || die 6 "no artifact at '${APK}'"
    say "installing ${APK}"
    "${ADB}" -s "${SERIAL}" install -r -d "${APK}" >/dev/null \
        || die 6 "adb install failed for ${APK}"
}

# WHICH certificate is being measured is half the result. The project has
# already recorded one `verified` against a certificate Google had rotated
# away from, and the console's own universal APK download carries the
# RETIRED key while looking like it carries the live one.
report_signer() {
    local apksigner="${APKSIGNER}"
    if [ -z "${apksigner}" ]; then
        apksigner="$(ls -1 "${SDK_ROOT}"/build-tools/*/apksigner 2>/dev/null | sort | tail -n1 || true)"
    fi
    if [ -z "${apksigner}" ] || [ ! -x "${apksigner}" ] || [ ! -f "${APK}" ]; then
        say "signer certificate: NOT READ (no apksigner, or no local artifact to read)"
        return 0
    fi
    local fp
    fp="$("${apksigner}" verify --print-certs "${APK}" 2>/dev/null \
        | sed -n 's/.*certificate SHA-256 digest: *//p' | head -n1)"
    if [ -n "${fp}" ]; then
        SIGNER_FP="${fp}"
        say "signer certificate SHA-256: ${fp}"
    else
        say "signer certificate: NOT READ (apksigner printed no digest)"
    fi
}

# ------------------------------------------------------------ the verdict

# `pm get-app-links` prints the domain states under a `Domain verification
# state:` heading and then repeats the domains under each `User N:` block
# with a different meaning (the user's own selection). Reading the first
# match anywhere in the output mixes the two.
read_state() {
    "${ADB}" -s "${SERIAL}" shell pm get-app-links "${PKG}" 2>&1 | awk -v want="${DOMAIN}" '
        /Unknown command/ { print "UNKNOWN_COMMAND"; exit }
        /Domain verification state:/ { inblock = 1; next }
        /^[[:space:]]*User [0-9]+:/ { inblock = 0 }
        inblock {
            line = $0
            sub(/^[[:space:]]+/, "", line)
            sub(/[[:space:]]+$/, "", line)
            idx = index(line, ":")
            if (idx > 0) {
                d = substr(line, 1, idx - 1)
                s = substr(line, idx + 1)
                sub(/^[[:space:]]+/, "", s)
                if (d == want) { print s; exit }
            }
        }
    ' | tr -d '\r' || true
}

reset_and_reverify() {
    # Without the reset the run re-reads a cached verdict, which is not a
    # measurement of anything that happened today.
    adbsh pm set-app-links --package "${PKG}" 0 all >/dev/null 2>&1 || true
    adbsh pm verify-app-links --re-verify "${PKG}" >/dev/null 2>&1 || true
}

# Poll until the domain reaches a state that is not `none` and not empty.
# Echoes the last state seen.
poll_state() {
    local budget="$1"
    local waited=0 state=""
    while :; do
        state="$(read_state)"
        case "${state}" in
            ""|none) ;;
            *) echo "${state}"; return 0 ;;
        esac
        [ "${waited}" -ge "${budget}" ] && break
        sleep "${POLL}"
        waited=$((waited + POLL))
    done
    echo "${state}"
}

# ---------------------------------------------------------------- the run

SIGNER_FP=""

if [ -z "${APK}" ]; then APK="${XCHAIN_APPLINKS_APK:-}"; fi
if [ -z "${APK}" ] && [ "${DO_INSTALL}" = "1" ]; then
    # One unambiguous candidate or none: guessing between two release
    # directories is how a verdict gets recorded against the wrong build.
    APK="$(ls -1t "${WS_ROOT}"/release-artifacts/*/xchain-wallet-v*.apk 2>/dev/null | head -n1 || true)"
    if [ -z "${APK}" ]; then
        die 6 "no artifact given and none found under release-artifacts/*/xchain-wallet-v*.apk; pass --apk"
    fi
    say "artifact not given; using the newest staged one: ${APK}"
fi

assert_playstore_image_string

if [ "${DO_PROVISION}" = "1" ]; then
    provision
    assert_avd_image
    boot
else
    say "--no-provision: using whatever is attached at ${SERIAL}"
fi

assert_device_can_answer

if [ "${DO_INSTALL}" = "1" ]; then
    install_artifact
    report_signer
else
    say "--no-install: measuring the install already on the device"
fi

say "resetting the verdict and asking for re-verification"
reset_and_reverify

say "polling up to ${TIMEOUT}s for a verdict on ${DOMAIN}"
STATE="$(poll_state "${TIMEOUT}")"

emit_json() {
    [ "${JSON}" = "1" ] || return 0
    printf '{"package":"%s","domain":"%s","state":"%s","verdict":"%s","signer":"%s","falsified":%s}\n' \
        "${PKG}" "${DOMAIN}" "${STATE:-none}" "$1" "${SIGNER_FP}" \
        "$([ "${FALSIFY}" = "1" ] && echo true || echo false)"
}

case "${STATE}" in
    UNKNOWN_COMMAND)
        emit_json unsupported
        warn "REFUSING: 'pm get-app-links' is Unknown command on ${SERIAL} (API 31+ only)."
        exit 3
        ;;
    verified)
        say "${DOMAIN}: verified"
        ;;
    ""|none)
        emit_json no-verdict
        warn "NO VERDICT: ${DOMAIN} is still 'none' after ${TIMEOUT}s."
        warn "'none' is the ABSENCE of a verdict, never a pass and never a fail: it means the"
        warn "verification agent was never invoked for ${PKG}. That is what a google_apis"
        warn "image does, and this run believed it was on a Play image, so something about"
        warn "this venue is not what it claims. Check 'adb -s ${SERIAL} shell pm get-app-links"
        warn "com.android.vending' - if OTHER packages hold real states, the machinery is"
        warn "present and simply is not running for ours. Do not record this either way."
        exit 4
        ;;
    1024)
        emit_json failed
        warn "NOT VERIFIED: ${DOMAIN} is 1024 (STATE_FIRST_VERIFIER_DEFINED, the agent's error"
        warn "state). Measured cause: the device could not fetch"
        warn "https://${DOMAIN}/.well-known/assetlinks.json. Check the device's network first,"
        warn "then that the file is served 200 as application/json to a plain client."
        exit 5
        ;;
    *)
        emit_json failed
        warn "NOT VERIFIED: ${DOMAIN} is '${STATE}'."
        warn "This is a stated verdict rather than an absent one, so it is a real failure:"
        warn "the installed certificate is not among the sha256_cert_fingerprints published"
        warn "at https://${DOMAIN}/.well-known/assetlinks.json. Compare the signer digest"
        warn "printed above against that file before changing anything."
        exit 5
        ;;
esac

# ------------------------------------------------------------ falsification

if [ "${FALSIFY}" = "1" ]; then
    say "falsifying: taking ${SERIAL} offline and requiring the verdict to change"
    adbsh svc wifi disable >/dev/null 2>&1 || true
    adbsh svc data disable >/dev/null 2>&1 || true
    reset_and_reverify
    OFFLINE_STATE="$(poll_state "${TIMEOUT}")"

    adbsh svc wifi enable >/dev/null 2>&1 || true
    adbsh svc data enable >/dev/null 2>&1 || true

    if [ "${OFFLINE_STATE}" = "verified" ]; then
        STATE="verified"
        emit_json not-contingent
        warn "NOT CONTINGENT: ${DOMAIN} still reads 'verified' with the device offline."
        warn "A verdict that appears whether or not https://${DOMAIN}/.well-known/assetlinks.json"
        warn "can be fetched measures a cache, not the published file, so the pass above cannot"
        warn "be relied on. Re-run after a full reset of the device state."
        exit 7
    fi
    say "offline verdict: ${OFFLINE_STATE:-none} (not verified, as required)"

    say "restoring the network and re-measuring"
    reset_and_reverify
    STATE="$(poll_state "${TIMEOUT}")"
    if [ "${STATE}" != "verified" ]; then
        emit_json failed
        warn "NOT VERIFIED after restoring the network: ${DOMAIN} is '${STATE:-none}'."
        warn "The offline half held, so the reading is contingent; this half is a real failure"
        warn "or a network that did not come back. Re-run before treating it as a regression."
        exit 5
    fi
    say "${DOMAIN}: verified again with the network restored - the verdict is contingent"
fi

if [ "${DO_PROVISION}" = "1" ] && [ "${KEEP_RUNNING}" = "0" ]; then
    say "shutting the emulator down (--keep-running to leave it up)"
    "${ADB}" -s "${SERIAL}" emu kill >/dev/null 2>&1 || true
fi

emit_json verified
say "PASS: ${DOMAIN} is App-Links verified for ${PKG} on ${SERIAL}"
say "This measured the certificate the INSTALLED artifact carries. Google's CURRENT Play"
say "app-signing certificate reaches a device only through a real Play delivery, so the"
say "tester-account install remains a manual step: install from Play, then re-run with"
say "--no-provision --no-install."
exit 0
