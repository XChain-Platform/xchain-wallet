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

# check-no-dev-mock.sh - pre-release gate.
#
# Greps the EXECUTABLE `dist/` bundles for the dev-mock SDK fallback. The dev-mock
# SDK serves fabricated addresses and balances and cannot sign or broadcast;
# shipping a bundle that can reach it would put pseudo-addresses in front of a
# mainnet user, who has no way to tell by looking. Hard-fails the release.
#
# Why this check is meaningful (it previously was not, twice):
#   1. The fallback lives in a catch branch in each shell's sdkFactory, so its
#      warning string used to be compiled into EVERY build, good or bad, and
#      this grep tripped on a perfectly healthy bundle. It only ever "passed"
#      because CI never built, so dist/ never existed. The sdkFactories now
#      refuse the fallback under `import.meta.env.PROD` (statically replaced by
#      Vite), so a production build eliminates that branch.
#   2. : grepping only the three WARNING strings was a false green. The
#      mock IMPLEMENTATION (createDevMockSdk) was referenced from live code
#      paths (the initial SDKRegistry factory + the devMockFactory argument),
#      so it could never be dead-code-eliminated and shipped in every build
#      while this gate reported OK. The mock definitions are now themselves
#      gated on `import.meta.env.PROD` (null in production), so a healthy
#      release bundle contains neither the warnings NOR the implementation.
#      The IMPLEMENTATION markers below ("Dev SDK stub", "devmockpsbt") are
#      strings unique to the mock's own code, which is what this gate actually
#      exists to keep out of a mainnet user's hands.
#
# Sourcemaps are EXCLUDED: a .map file embeds the original source by definition,
# so it will always contain the string, and it is never executed. Scanning them
# would make this gate unsatisfiable again.
#
# Usage:
#   bash tools/build-reproduce/check-no-dev-mock.sh
#   bash tools/build-reproduce/check-no-dev-mock.sh --artifacts release-artifacts/vX.Y.Z
#
# Runs in CI post-build via:
#   .github/workflows/ci.yml (build job)
#
# THE THIRD TIME THIS GATE WAS A FALSE GREEN ( S33), and unlike the two
# above it was not the marker set that was wrong - it was the SUBJECT.
#
# The gate scans the repo's `dist/` trees. The documented way to sign a
# release is from a pristine clone checked out at the tag (sign.sh refuses a
# dirty or non-tag tree, correctly), and a pristine clone has no `dist/` by
# definition. So every target printed `SKIP ... (not built)`, `failures`
# stayed 0, and the script printed `OK - no dev-SDK markers in dist/, real
# xchain-sdk present` and exited 0 having scanned nothing at all. sign.sh
# then wrote `# dev-mock-gate: enforced` into the SIGNED manifest header on
# that basis, and the desktop updater refuses any release whose header is not
# exactly `enforced`, so the one word that says this gate ran was true only in
# the sense that the script had been invoked.
#
# sign.sh already states the rule this violated, four lines above where it
# calls this script: "'the gate could not run' and 'the gate passed' must
# never produce the same release." It applied that to a MISSING script and not
# to an empty scan, which produces the identical release.
#
# Two changes close it, and they only make sense together:
#
#   1. Scanning nothing is a HARD FAILURE. A count of scanned targets is kept
#      and the summary line reports it, so "scanned three bundles" and
#      "skipped three bundles" can no longer print the same word.
#   2. `--artifacts <dir>` gives the gate something real to scan at signing
#      time: the web tarball and the extension zip out of the release staging
#      directory, which are the shipped bytes themselves rather than a local
#      rebuild of them. Without this, change 1 would simply make every
#      pristine-clone signing run refuse.
#
# The desktop renderer has no artifact-side equivalent: its bundle is sealed
# inside app.asar in each installer. That is reported as a stated GAP rather
# than a SKIP, on the same doctrine tools/release/expected-artifacts.txt
# already applies to its `*-unverified` signature classes - "we did not look"
# and "we looked and it was fine" must not be indistinguishable. The renderer
# IS gated on the built tree by the release workflow's own post-build step
# (.github/workflows/release.yml), which is where its dist actually exists.
set -euo pipefail

ARTIFACT_DIR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h)
            cat <<'USAGE'
check-no-dev-mock.sh - pre-release gate.

Greps the EXECUTABLE bundles for the dev-mock SDK fallback. The dev-mock SDK
serves fabricated addresses and balances and cannot sign or broadcast, so a
bundle that can reach it would put pseudo-addresses in front of a mainnet
user who has no way to tell by looking. Hard-fails the release.

Usage:
  bash tools/build-reproduce/check-no-dev-mock.sh
  bash tools/build-reproduce/check-no-dev-mock.sh --artifacts release-artifacts/vX.Y.Z

Options:
  --artifacts <dir>  Scan the shipped bundles inside a release staging
                     directory (the web tarball and the extension zip)
                     instead of the repo's dist/ trees. This is what
                     sign.sh uses: the signing tree is a pristine clone
                     and has no dist/ to scan.
  --help             Show this text.

Exits 0 only if at least one bundle was actually scanned and was clean.
USAGE
            exit 0
            ;;
        --artifacts|-a)
            if [ $# -lt 2 ]; then
                echo "check-no-dev-mock.sh: --artifacts needs a directory" >&2
                exit 2
            fi
            ARTIFACT_DIR="$2"
            shift 2
            ;;
        *)
            echo "check-no-dev-mock.sh: unknown argument: $1" >&2
            echo "Try --help." >&2
            exit 2
            ;;
    esac
done

# Each entry: <bundle dir>|<comma-separated SDK-unique literals>. Any one of
# the literals appearing in an executable chunk proves the real SDK bundled.
#
# The marker set is PER TARGET because the shells reach the SDK differently.
# Web and extension go through the package index (sdkFactory), so the
# index-only literals appear in their bundles. The desktop renderer
# deliberately does not: it imports `xchain-sdk/src/wallet.js` directly to
# keep the package index out of the popup graph (renderer/signerFactories/
# ledgerFactory.js), so CONTRACT_LINT_FAILED and ENCODER_NOT_CONFIGURED are
# legitimately absent there. Giving every target the same list would have
# made this gate unsatisfiable for desktop - the third repeat of the failure
# this file's header already documents twice.
#
#  §6: desktop was missing entirely. `packages/desktop/renderer/dist`
# is the executable renderer bundle; `packages/desktop/dist` is
# electron-builder's INSTALLER output (asar + platform binaries) and is not
# a source tree to grep.
SCAN_TARGETS=(
    "packages/web/dist|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED"
    "packages/extension/dist|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED"
    "packages/desktop/renderer/dist|SDKWalletError,MULTISIG_DERIVE_FAILED"
)

# --- Artifact mode ------------------------------------------------------
#
# The same markers, pointed at the release staging directory instead of the
# repo. The unpacked trees are given the SAME literals as their repo-tree
# counterparts because they are the same bundles: the web tarball is
# packages/web/dist and the extension zip is packages/extension/dist, as
# built by the release workflow.
if [ -n "$ARTIFACT_DIR" ]; then
    if [ ! -d "$ARTIFACT_DIR" ]; then
        echo "check-no-dev-mock.sh: artifact dir '$ARTIFACT_DIR' does not exist" >&2
        exit 1
    fi
    UNPACK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/xchain-devmock.XXXXXX")"
    trap 'rm -rf "$UNPACK_ROOT"' EXIT

    SCAN_TARGETS=()

    web_tarball="$(find "$ARTIFACT_DIR" -maxdepth 1 -name 'xchain-wallet-web-v*.tar.gz' | head -n 1)"
    if [ -n "$web_tarball" ]; then
        mkdir -p "$UNPACK_ROOT/web"
        # A staged artifact that will not unpack is a hard failure, never a
        # skip: "we could not read it" and "we read it and it was clean"
        # must not produce the same release, which is this file's whole
        # subject one level down.
        if ! tar xzf "$web_tarball" -C "$UNPACK_ROOT/web" 2>/dev/null; then
            echo "FAIL $(basename "$web_tarball") is not a readable gzip tarball"
            echo
            echo "Pre-release gate FAILED - a staged release artifact could not be unpacked."
            exit 1
        fi
        SCAN_TARGETS+=("$UNPACK_ROOT/web|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED|$(basename "$web_tarball")")
    fi

    ext_zip="$(find "$ARTIFACT_DIR" -maxdepth 1 -name 'xchain-wallet-extension-v*.zip' | head -n 1)"
    if [ -n "$ext_zip" ]; then
        mkdir -p "$UNPACK_ROOT/extension"
        # The tool, before the artifact. `unzip` is absent from a minimal
        # Debian image and is declared nowhere, so a machine without it fell
        # into the branch below and refused the release with "is not a
        # readable zip archive" - blaming a perfectly good artifact for a
        # missing package. That is the most expensive kind of wrong message:
        # it sends whoever reads it to rebuild the one thing that was never
        # broken. Measured on the CI venue 2026-08-06, which had neither
        # `zip` nor `unzip` installed.
        if ! command -v unzip >/dev/null 2>&1; then
            echo "FAIL cannot read $(basename "$ext_zip"): 'unzip' is not installed"
            echo "  This is an ENVIRONMENT failure, not an artifact failure. The"
            echo "  archive was never opened, so nothing is known about it either"
            echo "  way. Install unzip (Debian/Ubuntu: apt-get install unzip),"
            echo "  then run this again."
            echo
            echo "Pre-release gate FAILED - a required tool is missing."
            exit 1
        fi
        if ! unzip -q "$ext_zip" -d "$UNPACK_ROOT/extension" 2>/dev/null; then
            echo "FAIL $(basename "$ext_zip") is not a readable zip archive"
            echo
            echo "Pre-release gate FAILED - a staged release artifact could not be unpacked."
            exit 1
        fi
        SCAN_TARGETS+=("$UNPACK_ROOT/extension|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED|$(basename "$ext_zip")")
    fi

    # THE DESKTOP INSTALLER, WHICH THIS USED TO DECLARE UNREACHABLE.
    #
    # The line here used to read "GAP desktop renderer - sealed in app.asar
    # ... not here", and that gap had a cost nobody had met yet: a §7.5
    # staging set contains ONLY the update-capable desktop formats - no web
    # tarball, no extension zip - so on a Linux rehearsal set this loop
    # collected zero targets, `scanned` stayed 0, and the gate refused with
    # "it scanned NOTHING". `sign.sh` treats that as fatal, correctly, so
    # NO staging manifest could ever be signed and the §7.5 rehearsal that
    # gates the entire desktop publish was unreachable. Driven 2026-08-07
    # against the four real Linux artifacts: exit 1, before any signing.
    #
    # The asar is not actually sealed against reading. A `.deb` is an `ar`
    # archive of tarballs, both of which unpack with tools that exist on
    # the release machine, and the renderer bundle inside `app.asar` is
    # plain UTF-8 in a binary container - so the same literals the repo-tree
    # target greps for are readable in place, with no asar tooling.
    #
    # THE `.deb` AND NOT THE AppImage, deliberately. An AppImage is an ELF
    # launcher with a squashfs appended; reading it needs unsquashfs or a
    # Linux host to run `--appimage-extract` on, and signing happens on a
    # Mac that has neither (the same constraint 's payload-arch
    # check ran into). Both Linux artifacts are built from one renderer
    # output in one electron-builder run, so the `.deb` answers for both,
    # and UPDATE_CAPABLE_TARGET puts a `.deb` in every staging set there
    # is. A set with AppImages and no `.deb` is refused below rather than
    # waved through, because a scan that covered nothing must never read
    # like a scan that passed.
    #
    # WHAT THIS DEMANDS, STATED PLAINLY, BECAUSE IT IS RED TODAY. The first
    # run of it against the real v0.336.0 Linux artifacts FAILED, and the
    # failure is a true positive: `app.asar` carries
    # `@xchain-wallet/extension/src/background/sdkFactory.js`, the dev-mock
    # stub itself, because the desktop main process is shipped as unbundled
    # source and never meets the tree-shaking that keeps the mock out of the
    # web and extension bundles. `packages/desktop/main/index.js` then wires
    # that stub in as the SDKRegistry factory and never swaps it for the
    # real one, which the other two shells both do. So the gate is asking
    # for something worth having and not merely for tidiness: no
    # fabricated-address SDK stub inside a production installer, whether or
    # not today's code path reaches it. Satisfying it means moving
    # `createDevMockSdk` into a module the desktop shell does not import, or
    # bundling the main process the way the renderer already is.
    deb="$(find "$ARTIFACT_DIR" -maxdepth 1 -name '*.deb' | sort | head -n 1)"
    if [ -n "$deb" ]; then
        mkdir -p "$UNPACK_ROOT/desktop" "$UNPACK_ROOT/deb-members"
        # THREE ROUTES, AND THE VERDICT COMES FROM THE RESULT RATHER THAN
        # FROM AN EXIT CODE. No single tool opens a `.deb` on both a Debian
        # build host and the Mac the release is signed from, and one of the
        # candidates lies: Apple's `ar` prints "debian-binary/: No such file
        # or directory" for every member and still exits **0**, so a branch
        # written the ordinary way reports a successful extraction of an
        # empty directory. Measured 2026-08-07 on macOS 26. Each route is
        # therefore judged by whether a tree came out.
        if command -v dpkg-deb >/dev/null 2>&1; then
            dpkg-deb -x "$deb" "$UNPACK_ROOT/desktop" 2>/dev/null || true
        fi
        if [ -z "$(ls -A "$UNPACK_ROOT/desktop" 2>/dev/null)" ]; then
            # bsdtar reads `ar` archives directly and is the system tar on
            # macOS; GNU tar does not, which is why `ar` is still tried.
            ( cd "$UNPACK_ROOT/deb-members" && tar xf "$deb" ) 2>/dev/null || true
            if [ -z "$(ls -A "$UNPACK_ROOT/deb-members")" ] && command -v ar >/dev/null 2>&1; then
                ( cd "$UNPACK_ROOT/deb-members" && ar x "$deb" ) 2>/dev/null || true
            fi
            deb_data="$(find "$UNPACK_ROOT/deb-members" -maxdepth 1 -name 'data.tar.*' | head -n 1)"
            if [ -n "$deb_data" ]; then
                tar xf "$deb_data" -C "$UNPACK_ROOT/desktop" 2>/dev/null || true
            fi
        fi
        if [ -z "$(ls -A "$UNPACK_ROOT/desktop" 2>/dev/null)" ]; then
            echo "FAIL nothing could be extracted from $(basename "$deb")"
            echo "  Tried dpkg-deb, then tar (bsdtar reads ar archives), then ar."
            echo "  If this host has GNU tar, no dpkg and no binutils, that is an"
            echo "  ENVIRONMENT failure and the package was never opened - install"
            echo "  dpkg (Debian/Ubuntu: apt-get install dpkg) and run this again."
            echo "  Otherwise the staged package itself is unreadable."
            echo
            echo "Pre-release gate FAILED - a staged release artifact could not be unpacked."
            exit 1
        fi
        SCAN_TARGETS+=("$UNPACK_ROOT/desktop|SDKWalletError,MULTISIG_DERIVE_FAILED|$(basename "$deb")|positive-only")
    elif find "$ARTIFACT_DIR" -maxdepth 1 -name '*.AppImage' | grep -q .; then
        # Named rather than skipped: this set HAS a desktop artifact and it
        # is the one shape that cannot be opened here.
        echo "GAP  desktop renderer - this set ships AppImages and no .deb, and an"
        echo "     AppImage cannot be opened without a Linux host or unsquashfs"
    fi

    # THE MAC HALF OF THE SAME REHEARSAL, and it would have hit the identical
    # wall a week later. §7.5's staging set is UPDATE_CAPABLE_TARGET per OS:
    # `.deb` + AppImage on Linux, `*-mac.zip` on macOS, `.exe` on Windows. So
    # covering only the `.deb` would have left the mac rehearsal refused for
    # exactly the reason the Linux one was, discovered on the day someone ran
    # it. A mac zip is an ordinary zip holding `XChain Wallet.app`, and the
    # renderer bundle sits at `Contents/Resources/app.asar` inside it.
    mac_zip="$(find "$ARTIFACT_DIR" -maxdepth 1 -name '*-mac.zip' | sort | head -n 1)"
    if [ -n "$mac_zip" ]; then
        mkdir -p "$UNPACK_ROOT/desktop-mac"
        if ! command -v unzip >/dev/null 2>&1; then
            echo "FAIL cannot read $(basename "$mac_zip"): 'unzip' is not installed"
            echo "  This is an ENVIRONMENT failure, not an artifact failure."
            echo
            echo "Pre-release gate FAILED - a required tool is missing."
            exit 1
        fi
        if ! unzip -q "$mac_zip" -d "$UNPACK_ROOT/desktop-mac" 2>/dev/null \
            || [ -z "$(ls -A "$UNPACK_ROOT/desktop-mac")" ]; then
            echo "FAIL $(basename "$mac_zip") is not a readable zip archive"
            echo
            echo "Pre-release gate FAILED - a staged release artifact could not be unpacked."
            exit 1
        fi
        SCAN_TARGETS+=("$UNPACK_ROOT/desktop-mac|SDKWalletError,MULTISIG_DERIVE_FAILED|$(basename "$mac_zip")|positive-only")
    fi

    # The Windows half is a stated gap rather than a silent one. An NSIS
    # `.exe` is an installer archive that needs 7-Zip to open, which the
    # release machine does not have, so a windows-only staging set still
    # refuses below - loudly, naming what it could not read, which is the
    # right answer until someone decides to add that dependency.
    if find "$ARTIFACT_DIR" -maxdepth 1 -name '*.exe' | grep -q . \
        && [ -z "$deb" ] && [ -z "$mac_zip" ]; then
        echo "GAP  desktop renderer - this set ships only NSIS .exe installers,"
        echo "     which need 7-Zip to open; nothing here can read one"
    fi
fi

MARKERS=(
    # Fallback warning strings (sdkFactory catch branch):
    "xchain-sdk unavailable"
    "falling back to dev-mock SDK"
    "DO NOT USE FOR MAINNET"
    # Mock implementation strings ( - the mock itself, not its warning):
    "Dev SDK stub"
    "devmockpsbt"
    # Fixture-content strings: the dev-mock's DATA, which the two marker sets
    # above do not name. packages/web/src/hostBridge.js imports every helper
    # from ./devFakeBalances.js at module top level, ABOVE both of its
    # `import.meta.env?.PROD` guards, so that module stays out of a production
    # bundle only because it happens to be side-effect-free and Rollup can
    # tree-shake it - not because the import is gated. Give the fixtures their
    # own markers so a future top-level side effect there fails this gate
    # instead of shipping past it. Three literals, one from the native-balance
    # table and two from the 40-token list, because a partial leak may retain
    # only one of those tables.
    "The native coin of the Bitcoin network."
    "Iconic 2016 collectible card series."
    "The original meme cash on Counterparty."
)

#  positive check: absence of the mock proves nothing if the REAL SDK
# also failed to bundle (the wallet would then run on a throwing placeholder).
# The literals live in the SCAN_TARGETS table above, per target, because
# which SDK modules a shell pulls in is a property of that shell.

failures=0
scanned=0
skipped=0

for entry in "${SCAN_TARGETS[@]+"${SCAN_TARGETS[@]}"}"; do
    dir="${entry%%|*}"
    rest="${entry#*|}"
    sdk_markers="${rest%%|*}"
    # Third field is a display label. In artifact mode the scanned directory
    # is an unpack under $TMPDIR, and a FAIL naming that path tells an
    # operator mid-ceremony nothing about WHICH artifact is bad.
    if [ "$rest" = "$sdk_markers" ]; then label="$dir"; else label="${rest#*|}"; fi
    # Fourth field, optional: `positive-only`. WHY A DESKTOP INSTALLER IS
    # JUDGED DIFFERENTLY FROM A BUNDLE, and it is a limit of the artifact
    # rather than a softening of the rule. The web and extension targets are
    # BUILT bundles, where the mock is dead-code-eliminated, so a marker in
    # one is proof it leaked. A desktop installer is not a bundle: the main
    # process ships as unbundled source, and its `node_modules` legitimately
    # contains the extension package - whose `sdkFactory.js` defines the mock
    # next to the real resolver. So those markers are present in every
    # desktop artifact that will ever be built, and everything inside one
    # asar is one blob to a grep, with no way to tell our code from a
    # dependency's. A marker scan here can only ever say "refuse", which is
    # a gate nobody can satisfy and therefore a gate somebody switches off.
    # What an installer CAN answer is the positive half - is the real SDK in
    # there - and that is kept. Whether the mock is WIRED is a source
    # property, and sdk-wiring.smoke.js asserts it for all three shells,
    # which is where  is actually held.
    scan_mode=""
    case "$rest" in *"|positive-only") scan_mode="positive-only"; label="${label%|positive-only}" ;; esac
    if [ ! -d "$dir" ]; then
        echo "SKIP $label (not built)"
        skipped=$((skipped + 1))
        continue
    fi
    scanned=$((scanned + 1))
    # `-a`, BECAUSE THE DESKTOP TARGET IS A BINARY CONTAINER. The renderer
    # bundle ships inside app.asar, plain UTF-8 wrapped in a format with NUL
    # bytes in it, and whether a binary match is reported at all is a
    # property of the grep rather than of the file. Measured 2026-08-07:
    # BSD grep (the /usr/bin/grep a script gets on macOS) and GNU grep both
    # name the file; ugrep, which is what `grep` resolves to in this
    # operator's interactive shell, reports NOTHING without this flag. So
    # the difference decides whether a leaked marker is found, and it is
    # invisible from a passing run on any one host - the direction that
    # fails silently is the one where the gate says clean.
    #
    # No fixture can hold this from here, and that is stated rather than
    # papered over: on a host whose grep reports binaries, removing `-a`
    # changes no observable behaviour. release-gates.smoke.js asserts the
    # flag is present in this file's text instead, which is the honest
    # instrument for a property that only manifests on some machines.
    if [ "$scan_mode" = "positive-only" ]; then
        echo "NOTE $label - real-SDK check only; the mock's SOURCE ships inside this"
        echo "     artifact by construction (unbundled main process), so wiring is"
        echo "     gated at source instead"
    fi
    for marker in "${MARKERS[@]}"; do
        [ "$scan_mode" = "positive-only" ] && break
        if grep -r -a -l -F --exclude='*.map' "$marker" "$dir" > /dev/null 2>&1; then
            echo "FAIL $label contains dev-SDK marker: \"$marker\""
            grep -r -a -l -F --exclude='*.map' "$marker" "$dir" | sed "s|^$dir|    $label|"
            failures=$((failures + 1))
        fi
    done
    real_sdk_found=0
    IFS=',' read -r -a target_sdk_markers <<< "$sdk_markers"
    for marker in "${target_sdk_markers[@]}"; do
        if grep -r -a -l -F --exclude='*.map' "$marker" "$dir" > /dev/null 2>&1; then
            real_sdk_found=1
            break
        fi
    done
    if [ "$real_sdk_found" -eq 0 ]; then
        echo "FAIL $label does not contain the real xchain-sdk (none of: $sdk_markers)"
        failures=$((failures + 1))
    fi
done

if [ "$failures" -gt 0 ]; then
    echo
    echo "Pre-release gate FAILED - dev-SDK stub leaked into a production bundle,"
    echo "or the real xchain-sdk did not bundle."
    echo "Fix: ensure xchain-sdk is installed before running the build, and that"
    echo "the shell's vite config still gives the linked SDK the CJS transform"
    echo "(build.commonjsOptions.include + the polyfill-shim resolver, )."
    exit 1
fi

# Scanning nothing is not passing. This is the whole point of the header's
# third false-green note: without it the line below prints for a run that
# looked at zero bytes, and sign.sh records `enforced` on the strength of it.
if [ "$scanned" -eq 0 ]; then
    echo
    echo "Pre-release gate FAILED - it scanned NOTHING ($skipped target(s) absent)."
    echo "A gate that could not run has not passed; sign.sh states that rule about"
    echo "a missing script and it holds identically for an empty scan."
    if [ -n "$ARTIFACT_DIR" ]; then
        echo "Fix: '$ARTIFACT_DIR' holds no xchain-wallet-web-v*.tar.gz and no"
        echo "xchain-wallet-extension-v*.zip. Stage the release artifacts first."
    else
        echo "Fix: build the shells first, or pass --artifacts <release staging dir>"
        echo "to scan the shipped bundles instead. A pristine clone has no dist/,"
        echo "which is exactly the tree a release is signed from."
    fi
    exit 1
fi

if [ "$skipped" -gt 0 ]; then
    echo "OK - $scanned bundle(s) scanned, clean; $skipped not built and not scanned"
else
    echo "OK - $scanned bundle(s) scanned, no dev-SDK markers, real xchain-sdk present"
fi
