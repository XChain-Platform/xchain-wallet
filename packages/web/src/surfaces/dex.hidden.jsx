// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The DEX surface, ABSENT (; §2.3).
//
// `vite.config.js` swaps `dex.jsx` for this file when the build profile hides
// the `dex` surface, so this is the module a mobile store build actually runs.
// Its whole content is the absence: it imports nothing, which is what keeps
// every DEX route component out of the bundle. There is no flag here to flip
// and no lazy import to reach them by, because a store-hidden surface that can
// be switched back on is an App Review guideline 2.3.1 hidden feature, and
// that penalty is account termination across every Apple surface we have.
//
// Keep the export list identical to `dex.jsx`: this twin is the one that runs
// on the shell with the least coverage, so a missing name here is an undefined
// at runtime in the place hardest to notice. A unit test asserts the parity.

/** @see {@link ./dex.jsx} - false here is the entire mechanism. */
export const DEX_SURFACE_ENABLED = false;

/**
 * Always null: this build has no DEX view to render.
 *
 * The web shell falls through to Home for any view it does not match, so a
 * `markets` view arriving from anywhere (a restored session, a deep link, a
 * stale memory) lands on Home rather than on a blank screen.
 *
 * @returns {null}
 */
export function renderDexRoute() {
    return null;
}
