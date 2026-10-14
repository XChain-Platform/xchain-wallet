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
 * Schedule non-critical shell work after the browser has an opportunity to
 * paint the current lock or home screen.
 *
 * @param {() => void} work
 * @returns {() => void} cancels work that has not started
 */
export function deferNonCriticalWork(work) {
    if (typeof globalThis.requestIdleCallback === 'function') {
        const id = globalThis.requestIdleCallback(work, { timeout: 1000 });
        return () => globalThis.cancelIdleCallback?.(id);
    }

    const id = setTimeout(work, 16);
    return () => clearTimeout(id);
}
