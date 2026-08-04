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

# tools/release/emulation-preflight.sh - decide, BEFORE a reproduce run
# starts, whether this host can actually execute the amd64 build.
#
# WHY THIS EXISTS. Every reproduce lane pins an amd64-only base image and
# passes `--platform linux/amd64`, so an arm64 verifier runs the whole
# build under emulation. Two emulators can serve that platform flag and
# they are not interchangeable:
#
#   Rosetta      Apple's translator, reached either through Docker Desktop
#                on Apple Silicon or through an arm64 Linux VM with
#                "Rosetta for Linux" enabled (Parallels/UTM), which
#                registers a binfmt handler named RosettaLinux. Runs the
#                build correctly. Measured 2026-08-04: an aarch64 Ubuntu
#                VM reproduced the extension bundle byte-identically to a
#                native amd64 host.
#
#   qemu-user    what `docker run --privileged tonistiigi/binfmt --install
#                amd64` registers. Handles most binaries and handles Go's
#                runtime worst, so the build dies MINUTES IN, inside the
#                bundler, with a message that names neither qemu nor the
#                architecture:
#
#                  extension lane: `[vite:define] The service was stopped`
#                                  after a goroutine traceback out of
#                                  esbuild/pkg/api.Transform
#                  desktop lane:   `fatal error: lfstack.push` with a
#                                  truncated pointer, out of Go's GC
#
#                Both read as a defect in the wallet. Neither is one.
#
# So the platform flag is necessary and not sufficient, and the failure it
# leaves behind is unreadable. This runs first, costs nothing, and refuses
# the emulator that cannot finish rather than letting a verifier spend
# twenty minutes discovering it.
#
# Everything it reads is an input, so the decision table is drivable by a
# test without any emulator present:
#
#   XCHAIN_HOST_ARCH                  default `uname -m`
#   XCHAIN_HOST_OS                    default `uname -s`
#   XCHAIN_BINFMT_DIR                 default /proc/sys/fs/binfmt_misc
#   XCHAIN_REPRODUCE_ALLOW_EMULATION  1 = proceed anyway, loudly
#
# Exit 0 proceed, exit 3 refuse.

set -euo pipefail

# THE FLAG WAS NOT IGNORED, IT WAS CONSUMED . The only positional
# this script takes is a Docker platform, so `emulation-preflight.sh --help`
# ran the whole decision table against a target platform literally named
# `--help` and printed
#
#   [preflight] host arm64 must EMULATE --help
#
# then exited 0. Exit 0 is what makes that the dangerous shape rather than
# the annoying one: an operator, a caller and a gate all read it as a help
# screen having been printed, and the same consumption in a sibling tool
# ran a browser capture and overwrote three store listing assets.
#
# So help is answered here, and any other leading-dash argument is REFUSED
# rather than silently accepted as a platform name. A typo'd flag must not
# be able to become the thing this script is deciding about.
case "${1:-}" in
    -h|--help)
        cat <<'USAGE'
emulation-preflight.sh - can this host actually execute the amd64
reproducible build, or will it die minutes in inside the bundler?
( reproducible-build lane.)

Usage:
  bash tools/release/emulation-preflight.sh [platform]

  platform   Docker platform to check, default linux/amd64.

Exit codes:
  0  proceed: native, or an emulator that finishes (Rosetta)
  3  refuse:  qemu-user or an unknown emulator, which crashes the build
              with a message that names neither qemu nor the architecture

Environment (every input is overridable, so the decision table is drivable
by a test with no emulator present):
  XCHAIN_HOST_ARCH                  default `uname -m`
  XCHAIN_HOST_OS                    default `uname -s`
  XCHAIN_BINFMT_DIR                 default /proc/sys/fs/binfmt_misc
  XCHAIN_REPRODUCE_ALLOW_EMULATION  1 = proceed anyway, loudly
USAGE
        exit 0
        ;;
    -*)
        echo "[preflight] unknown option '$1'" >&2
        echo "[preflight] the only positional this script takes is a Docker platform" >&2
        echo "[preflight] (default linux/amd64). Try --help." >&2
        exit 2
        ;;
esac

TARGET_PLATFORM="${1:-linux/amd64}"
TARGET_ARCH="${TARGET_PLATFORM##*/}"

HOST_ARCH="${XCHAIN_HOST_ARCH:-$(uname -m)}"
HOST_OS="${XCHAIN_HOST_OS:-$(uname -s)}"
BINFMT_DIR="${XCHAIN_BINFMT_DIR:-/proc/sys/fs/binfmt_misc}"
ALLOW="${XCHAIN_REPRODUCE_ALLOW_EMULATION:-0}"

say() { echo "[preflight] $*"; }

# Normalize the several spellings of the same two architectures. `uname -m`
# says x86_64 where Docker platforms say amd64, and aarch64 where they say
# arm64; comparing the two spellings directly would call every arm64 Linux
# host a mismatch AND every amd64 one an emulator.
normalize_arch() {
    case "$1" in
        x86_64|amd64)  echo amd64 ;;
        aarch64|arm64) echo arm64 ;;
        *)             echo "$1" ;;
    esac
}

HOST_ARCH_N="$(normalize_arch "${HOST_ARCH}")"
TARGET_ARCH_N="$(normalize_arch "${TARGET_ARCH}")"

routes() {
    cat <<'MSG'
[preflight] Routes that DO work, in order of preference:
[preflight]
[preflight]   1. An amd64 Linux host with Docker. No emulation, no caveats.
[preflight]   2. Docker Desktop on Apple Silicon with "Use Rosetta for
[preflight]      x86_64/amd64 emulation" enabled in Settings > General.
[preflight]   3. An arm64 Linux VM with Rosetta for Linux enabled
[preflight]      (Parallels or UTM on Apple Silicon). It registers a
[preflight]      binfmt handler named RosettaLinux, which this check finds.
[preflight]
[preflight] To run anyway (a build that has been observed to crash):
[preflight]   XCHAIN_REPRODUCE_ALLOW_EMULATION=1
MSG
}

refuse() {
    say "REFUSING TO START: $1"
    routes
    exit 3
}

if [ "${HOST_ARCH_N}" = "${TARGET_ARCH_N}" ]; then
    say "host ${HOST_ARCH} runs ${TARGET_PLATFORM} natively"
    exit 0
fi

say "host ${HOST_ARCH} must EMULATE ${TARGET_PLATFORM}"

# macOS: binfmt_misc is a Linux mechanism, so which emulator Docker Desktop
# hands the container is not readable from here. Advise rather than refuse -
# Docker Desktop with Rosetta is a supported route and refusing it would
# block the most likely arm64 verifier.
if [ "${HOST_OS}" = "Darwin" ]; then
    say "macOS host: Docker Desktop chooses the emulator, which is not visible from here."
    say "Enable Settings > General > 'Use Rosetta for x86_64/amd64 emulation' before running."
    say "Without it the build crashes inside the bundler's Go runtime, several minutes in."
    exit 0
fi

if [ "${ALLOW}" = "1" ]; then
    say "XCHAIN_REPRODUCE_ALLOW_EMULATION=1: proceeding without checking the emulator."
    say "If this build dies inside the bundler with a Go traceback, that is the emulator."
    exit 0
fi

if [ ! -d "${BINFMT_DIR}" ]; then
    refuse "no ${BINFMT_DIR}, so no way to tell what would execute the ${TARGET_ARCH_N} binaries."
fi

# An entry is only interesting when it is enabled AND claims the target
# architecture. Name matching is what separates the two emulators; the
# `enabled` line is what stops a stale, disabled registration from reading
# as a working route.
rosetta_handler=""
qemu_handler=""
for entry in "${BINFMT_DIR}"/*; do
    [ -f "${entry}" ] || continue
    name="$(basename "${entry}")"
    case "${name}" in
        register|status) continue ;;
    esac
    head -n1 "${entry}" 2>/dev/null | grep -qx "enabled" || continue

    shopt -s nocasematch
    if [[ "${name}" == *rosetta* ]]; then
        rosetta_handler="${name}"
    elif [[ "${name}" == *qemu-x86_64* || "${name}" == *qemu-amd64* ]]; then
        qemu_handler="${name}"
    fi
    shopt -u nocasematch
done

if [ -n "${rosetta_handler}" ] && [ -n "${qemu_handler}" ]; then
    # Both registered: the kernel picks by registration order, which
    # binfmt_misc does not expose, so this cannot be called either way.
    say "WARNING: both ${rosetta_handler} and ${qemu_handler} are registered for amd64."
    say "Which one runs is registration order, which is not readable here. If this"
    say "build dies inside the bundler with a Go traceback, qemu won; unregister it:"
    say "  sudo sh -c 'echo -1 > ${BINFMT_DIR}/${qemu_handler}'"
    exit 0
fi

if [ -n "${rosetta_handler}" ]; then
    say "emulation via ${rosetta_handler} (Rosetta), which runs this build correctly."
    say "Expect a speed penalty, not a crash."
    exit 0
fi

if [ -n "${qemu_handler}" ]; then
    refuse "${qemu_handler} (qemu user-mode) is the only amd64 emulator registered, and it crashes this build inside esbuild's Go runtime."
fi

refuse "no amd64 emulation is registered at all; the first amd64 binary would fail with an exec-format error."
