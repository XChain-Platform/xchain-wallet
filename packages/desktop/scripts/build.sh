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

# Deterministic build entry point - runs INSIDE the reproducible-build
# Docker image. See packages/desktop/Dockerfile + scripts/reproduce.sh.
#
# Assumptions (enforced by the Dockerfile + reproduce.sh):
#   - cwd is /workspace (the mounted repo root)
#   - SOURCE_DATE_EPOCH is set (reproduce.sh derives it from HEAD)
#   - LC_ALL / LANG / TZ are pinned (C.UTF-8 / UTC)
#   - /out is mounted writable for build artifacts

set -euo pipefail

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH must be set - reproduce.sh sets this from the commit date}"

echo "[xchain-wallet] build.sh - SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
echo "[xchain-wallet] node: $(node --version) - pnpm: $(pnpm --version)"

# A cached image built from an older Dockerfile carries an older Node, and
# the only symptom would be a hash diff the protocol tells verifiers to
# read as tampering. Fail here instead, where the message names the cause.
# reproduce.sh passes the expected version from the ref's toolchain.json.
if [ -n "${XCHAIN_EXPECTED_NODE:-}" ]; then
    actual="$(node --version)"
    if [ "${actual}" != "v${XCHAIN_EXPECTED_NODE}" ]; then
        echo "[xchain-wallet] FATAL: image has node ${actual}, the ref pins v${XCHAIN_EXPECTED_NODE}." >&2
        echo "[xchain-wallet] Rebuild the image from THIS ref's Dockerfile (docker build --no-cache)." >&2
        exit 1
    fi
fi

mkdir -p "${HOME:-/tmp}"
cd /workspace

# --- 1. Install deps -----------------------------------------------------
# `--frozen-lockfile` fails the build if pnpm-lock.yaml is out of sync
# with package.json - critical for reproducibility (unpinned deps are
# the most common source of non-determinism).
pnpm install --frozen-lockfile

# --- 2. Build renderer ---------------------------------------------------
# Vite's output under packages/desktop/renderer/dist goes into the
# Electron asar. SOURCE_DATE_EPOCH is honoured by vite via the
# esbuild-minify path; check the output metadata if hashes drift
# across verifications.
pnpm --filter @xchain-wallet/desktop run build:renderer

# --- 3. Package --------------------------------------------------------
# THIS BUILDS THE PACKAGED LINUX ARTIFACTS, NOT JUST THE UNPACKED BUNDLE,
# AND THAT CHANGE IS THE WHOLE POINT OF DD7 ( §11).
#
# It used to run `dist:unpacked` (electron-builder's `--dir` mode), which
# emits `linux-unpacked/` and `linux-arm64-unpacked/` directory trees and
# no installers. Both REPRODUCIBLE_BUILDS.md and docs/Verify_Release.md
# then ended the recipe by telling the verifier to diff that output
# against the release's published RELEASE_HASHES manifest and call zero
# bytes the proof - a comparison that can NEVER succeed, because the
# published manifest covers packaged artifacts (`.AppImage`, `.deb`,
# `.dmg`, `.exe`, the web tarball) and the two sets share no filename.
# The docs said so honestly rather than prescribing the impossible check,
# and the fix was left as a decision.
#
# The decision is taken: build what users actually download. The Linux
# artifacts carry no code signature, so unlike macOS and Windows they are
# reproducible EXACTLY AS SHIPPED, and the manifest below therefore
# carries the same filenames the release manifest does. That is what makes
# `sha256sum -c` against the official file a real check instead of a
# gesture.
#
# The precondition this rested on is paid, not assumed: all four packaged
# Linux artifacts reproduce byte-for-byte across two independent builds of
# one commit in this container (, after the mksquashfs wrapper
# normalised the two clocks the AppImage carried).
#
# Packaging still emits the unpacked trees as an intermediate, so the
# per-file diagnostic manifest below costs nothing extra and is what
# localises a mismatch to a file once the packaged hashes disagree.
#
# BOTH linux arches, because both are shipped (spec §2) and the release
# lane builds both from this same amd64 host. This took no arch flags
# before, so it defaulted to the host arch and reproduced x64 only: the
# arm64 bundle that real users install had no published pre-signing hash
# and no way for anyone to check it. The set comes from toolchain.json's
# linuxArches and the smoke test holds the release lane to the same list.
ARCH_FLAGS="$(node -e "
    const tc = require('/workspace/tools/release/toolchain.json');
    process.stdout.write(tc.linuxArches.map((a) => '--' + a).join(' '));
")"
echo "[xchain-wallet] linux arches: ${ARCH_FLAGS}"
#
# NO `--` SEPARATOR. pnpm 9 forwards a literal `--` into the script's
# argv (npm strips it), and electron-builder is yargs-based, so a bare
# `--` ends option parsing and every flag after it lands in `argv._`
# where nothing reads it. The observable result is an electron-builder
# that ignores `--linux --x64 --arm64` entirely and silently packages
# the host arch only - which is exactly what happened on the first real
# run of this script, caught by the coverage check below.
# shellcheck disable=SC2086 # word splitting is the point: one flag per arch
pnpm --filter @xchain-wallet/desktop run dist --linux ${ARCH_FLAGS}

# --- 4. Emit SHA256 manifest -------------------------------------------
# The verifier compares this manifest against the official release's
# published `RELEASE_HASHES.md`. Mismatches indicate either a build
# environment drift (toolchain pinning bug) or supply-chain tampering.
#
# Paths are relative to dist/ and sorted with LC_ALL=C (pinned by the
# image and re-asserted by reproduce.sh) so the manifest's ORDER is
# deterministic too - an unstable order would diff even when every hash
# matched. With two arches this now covers linux-unpacked/ and
# linux-arm64-unpacked/ in one file.
#
# The header records BOTH source inputs. The wallet commit alone does not
# identify this build: packages/desktop links xchain-sdk out of a sibling
# repository, so the same wallet tag against a different SDK commit is a
# different artifact. Two manifests can only be compared meaningfully if
# these lines agree. `#` lines are ignored by `sha256sum -c`, the same way
# tools/release/lib.sh writes its own manifest headers.
cd /workspace/packages/desktop/dist

# The comparable manifest: the PACKAGED artifacts, named exactly as the
# release publishes them, at the top level of dist/. `-maxdepth 1` is what
# keeps the unpacked trees out of this file; the artifacts electron-builder
# emits are all siblings there.
#
# Deliberately NOT filtered by extension. A glob list would silently drop a
# format added later (the exact shape of the `latest*.yml` defect in §7.1),
# so anything that is a top-level file is hashed, and the coverage check
# below then demands the four we ship. `builder-debug.yml` and the channel
# pointers are excluded by name because they are build metadata rather than
# artifacts, and the pointer is mutable by design (lib.sh excludes it from
# the release manifest for the same reason).
{
    echo "# xchain-wallet reproducible-build manifest (PACKAGED linux artifacts)"
    echo "#"
    echo "# These filenames are the ones the release publishes, so this file"
    echo "# compares directly with the official RELEASE_HASHES manifest:"
    echo "#"
    echo "#   diff <(grep -v '^#' official.txt | grep -E '\\.(AppImage|deb)\$' | sort) \\"
    echo "#        <(grep -v '^#' RELEASE_HASHES.txt | sort)"
    echo "#"
    echo "# Compare the manifests rather than the files: reproduce.sh builds in"
    echo "# a worktree it deletes on exit, so these hashes are what survives the"
    echo "# run, and a hash comparison is the same check."
    echo "#"
    echo "# wallet-commit: ${XCHAIN_WALLET_COMMIT:-unknown}"
    echo "# sdk-commit:    ${XCHAIN_SDK_COMMIT:-unknown}"
    echo "# sdk-pinned:    ${XCHAIN_SDK_PINNED:-unknown}"
    echo "# node:          $(node --version)"
    echo "# pnpm:          $(pnpm --version)"
    echo "# source-date-epoch: ${SOURCE_DATE_EPOCH}"
    find . -maxdepth 1 -type f \
        -not -name 'builder-debug.yml' \
        -not -name '*.yml' \
        -print0 \
        | sort -z \
        | xargs -0 sha256sum
} > /out/RELEASE_HASHES.txt

# The diagnostic manifest: every file of the unpacked trees, which
# packaging leaves behind as an intermediate. When the packaged hashes
# above disagree, this is what says WHICH file inside the bundle moved,
# and without it a mismatch is a 130MB binary diff.
{
    echo "# xchain-wallet reproducible-build manifest (UNPACKED trees, diagnostic)"
    echo "#"
    echo "# Not comparable with the published release manifest - these paths"
    echo "# exist only inside the build. Use it to localise a mismatch that"
    echo "# RELEASE_HASHES.txt has already found."
    echo "#"
    echo "# wallet-commit: ${XCHAIN_WALLET_COMMIT:-unknown}"
    echo "# source-date-epoch: ${SOURCE_DATE_EPOCH}"
    find . -mindepth 2 -type f -not -path '*/node_modules/*' -print0 \
        | sort -z \
        | xargs -0 sha256sum
} > /out/UNPACKED_HASHES.txt

# A manifest that covers only one arch is the exact failure the arch-flag
# fix addressed, and it would otherwise reappear silently as a short file.
# Checked on BOTH manifests, because they can now fail independently: the
# packaged one loses an arch if a target fails to wrap, the unpacked one if
# a lane did not build at all.
for arch_dir in $(node -e "
    const tc = require('/workspace/tools/release/toolchain.json');
    process.stdout.write(tc.linuxArches
        .map((a) => (a === 'x64' ? 'linux-unpacked' : 'linux-' + a + '-unpacked'))
        .join(' '));
"); do
    if ! grep -q " \./${arch_dir}/" /out/UNPACKED_HASHES.txt; then
        echo "[xchain-wallet] FATAL: unpacked manifest covers no files under ${arch_dir}/" >&2
        exit 1
    fi
done

# And the packaged set: one AppImage and one deb per shipped arch.
#
# Delegated rather than grepped, and that is not fastidiousness. The x64
# AppImage carries NO arch token (electron-builder omits it for the default
# arch when artifactName is not user-forced), so any pattern loose enough
# to match it also matches the arm64 file - a build that produced only
# arm64 would satisfy a grep for "the x64 AppImage". The checker
# attributes each artifact to exactly one arch instead, the same way
# tools/release/lib.sh does on the release side, and a smoke drives it
# without needing a container.
node /workspace/tools/build-reproduce/check-packaged-manifest.mjs /out/RELEASE_HASHES.txt

echo "[xchain-wallet] build.sh - done"
echo "Manifest (comparable): /out/RELEASE_HASHES.txt"
echo "Manifest (diagnostic): /out/UNPACKED_HASHES.txt"
