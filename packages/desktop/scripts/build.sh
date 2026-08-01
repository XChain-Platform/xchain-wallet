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
# `electron-builder --dir` produces the unpacked app only (no dmg/nsis/
# AppImage wrapping) - the Level-2 verification target is the
# pre-signing app bundle. Full packaging happens in the official
# release path (build-release.sh) where signing certs are present.
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
pnpm --filter @xchain-wallet/desktop run dist:unpacked --linux ${ARCH_FLAGS}

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
{
    echo "# xchain-wallet pre-signing manifest (electron-builder --dir)"
    echo "# wallet-commit: ${XCHAIN_WALLET_COMMIT:-unknown}"
    echo "# sdk-commit:    ${XCHAIN_SDK_COMMIT:-unknown}"
    echo "# node:          $(node --version)"
    echo "# pnpm:          $(pnpm --version)"
    echo "# source-date-epoch: ${SOURCE_DATE_EPOCH}"
    find . -type f -not -path '*/node_modules/*' -print0 \
        | sort -z \
        | xargs -0 sha256sum
} > /out/RELEASE_HASHES.txt

# A manifest that covers only one arch is the exact failure this stage
# fixed, and it would otherwise reappear silently as a short file.
for arch_dir in $(node -e "
    const tc = require('/workspace/tools/release/toolchain.json');
    process.stdout.write(tc.linuxArches
        .map((a) => (a === 'x64' ? 'linux-unpacked' : 'linux-' + a + '-unpacked'))
        .join(' '));
"); do
    if ! grep -q " \./${arch_dir}/" /out/RELEASE_HASHES.txt; then
        echo "[xchain-wallet] FATAL: manifest covers no files under ${arch_dir}/" >&2
        exit 1
    fi
done

echo "[xchain-wallet] build.sh - done"
echo "Manifest: /out/RELEASE_HASHES.txt"
