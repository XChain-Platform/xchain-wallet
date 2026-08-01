// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/rehearsal-matrix.mjs - the shipped update lanes, and what
// each one is smoked on ( §2, §7.5, DD4).
//
// WHAT A "LANE" IS HERE. Not an artifact and not a build lane: an
// OS/arch pair that receives updates, plus the ONE artifact format
// electron-updater can actually swap in place on it. dmg, deb and the
// Windows zip are shipped install formats with NO auto-update path, so
// they are not lanes - a rehearsal of them would exercise nothing (§7.5).
//
// THE TWO HALVES OF A LANE'S PROOF, and only one of them needs hardware:
//
//   selection + download + proof   Which artifact does an OS/arch pair
//                                  resolve out of the pointer, does it
//                                  download, does its hash match, and
//                                  does the K1-signed manifest cover it?
//                                  All of that is a property of the FEED
//                                  and is checked from anywhere. No
//                                  device needed - `rehearse.mjs run`
//                                  does every lane on one machine.
//
//   install + launch + swap        Whether the downloaded artifact
//                                  actually replaces the running app on
//                                  that OS/arch. This is the half that
//                                  needs the hardware in `device`.
//
// That split is worth stating because it moves DD4. DD4 asks what we
// smoke win-arm64 and linux-arm64 on, and specifically demands the
// UPDATE SELECTION check for win-arm64 (both Windows arches share one
// `stable.yml`, and upstream picks between them by substring-matching
// `process.arch` against the filename). Selection is the half that does
// not need an arm64 machine, so it is covered today, for every lane, by
// the probe. What is still blocked on DD4 is only the swap.
//
// `device: null` means DD4 has not been answered for that lane. Per the
// spec's own rule - "No named device for a lane = that lane does not
// ship" - `rehearse.mjs coverage` refuses to call such a lane launch-
// ready, and says so rather than passing quietly.

/**
 * @typedef {Object} Lane
 * @property {string} id        stable identifier, used in records
 * @property {string} os        node platform: win32 | darwin | linux
 * @property {string} arch      process.arch value: x64 | arm64
 * @property {string} format    the update-capable artifact extension
 * @property {string|null} device  named smoke hardware (DD4), or null
 * @property {string} [note]
 */

/** @type {Lane[]} */
export const LANES = [
    {
        id: 'win-x64',
        os: 'win32',
        arch: 'x64',
        format: 'exe',
        device: null,
        note: 'nsis. Shares stable.yml with win-arm64, so selection is load-bearing.',
    },
    {
        id: 'win-arm64',
        os: 'win32',
        arch: 'arm64',
        format: 'exe',
        device: null,
        note: 'nsis. DD4 names no device; selection out of stable.yml is probed regardless.',
    },
    {
        id: 'mac-x64',
        os: 'darwin',
        arch: 'x64',
        format: 'zip',
        device: null,
        note: 'zip, never dmg: the dmg has no auto-update path. Shares stable-mac.yml.',
    },
    {
        id: 'mac-arm64',
        os: 'darwin',
        arch: 'arm64',
        format: 'zip',
        device: 'Mac Studio (release machine)',
        note: 'The one lane whose hardware the program already owns.',
    },
    {
        id: 'linux-x64',
        os: 'linux',
        arch: 'x64',
        format: 'AppImage',
        device: null,
        note: 'AppImage only; deb is notify-only until escalation is verified (§5).',
    },
    {
        id: 'linux-arm64',
        os: 'linux',
        arch: 'arm64',
        format: 'AppImage',
        device: null,
        note: 'Own pointer (stable-linux-arm64.yml), so no selection to get wrong.',
    },
];

/**
 * Source paths whose change raises the per-release rehearsal requirement
 * from "one OS" to "every OS" (§7.5: "on ALL OSes when the release
 * touches updater or vault/storage code").
 *
 * WHY THIS IS A LIST AND NOT A JUDGEMENT CALL. As written, the rule asks
 * the person cutting the release to decide whether their own change
 * counts as touching the updater - at the end of a release, under time
 * pressure, about their own work. Every incentive points at "no". A path
 * list is answerable by `git diff --name-only` and gets the same answer
 * from anyone.
 *
 * Deliberately broad: a false "all OSes" costs a rehearsal, a false "one
 * OS" ships an untested swap to two thirds of the fleet.
 */
export const ALL_OS_TRIGGER_PATHS = [
    'packages/desktop/main/updater.js',
    'packages/desktop/main/updateVerify.js',
    'packages/desktop/main/storage.js',
    'packages/desktop/main/keychain.js',
    'packages/desktop/electron-builder.config.cjs',
    'packages/core/src/storage/',
    'tools/release/',
];

/** @param {string} id */
export function laneById(id) {
    return LANES.find((l) => l.id === id) ?? null;
}

/** Lanes grouped by OS, for the "at least one OS" requirement. */
export function lanesByOs() {
    const out = new Map();
    for (const lane of LANES) {
        if (!out.has(lane.os)) out.set(lane.os, []);
        out.get(lane.os).push(lane);
    }
    return out;
}
