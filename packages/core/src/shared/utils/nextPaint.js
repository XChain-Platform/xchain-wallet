// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Resolve after the browser has painted the current React state.
 *
 * The wallet's Argon2id key stretching runs on the UI thread and holds it
 * for most of a minute on a slow phone (about 40 s per derivation on an LG
 * K51, 2026-10-12). Awaiting this between setting a busy state and starting
 * that work is what lets the busy state reach the screen; without it the
 * old screen sits there frozen and looks hung.
 *
 * @returns {Promise<void>}
 */
export function nextPaint() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => setTimeout(resolve, 0));
        } else {
            setTimeout(resolve, 0);
        }
    });
}
