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
 * Run an interval only while the document is visible.
 *
 * Mobile WebViews propagate app foreground state through document visibility,
 * so stopping the timer here covers browser tabs and native app backgrounding.
 * The callback runs once on resume by default so a screen catches up without
 * waiting for a complete interval.
 *
 * @param {() => void} callback
 * @param {number} delayMs
 * @param {{ document?: Document | null, runOnVisible?: boolean }} [options]
 * @returns {() => void}
 */
export function startVisibleInterval(callback, delayMs, options = {}) {
    const doc = options.document === undefined
        ? (typeof document === 'undefined' ? null : document)
        : options.document;
    const runOnVisible = options.runOnVisible !== false;
    let timer = null;

    const clear = () => {
        if (timer === null) return;
        clearInterval(timer);
        timer = null;
    };
    const start = () => {
        if (timer !== null) return;
        timer = setInterval(() => {
            if (doc?.visibilityState === 'hidden') {
                clear();
                return;
            }
            callback();
        }, delayMs);
    };
    const sync = () => {
        if (doc?.visibilityState === 'hidden') {
            clear();
            return;
        }
        if (runOnVisible) callback();
        start();
    };

    if (doc?.visibilityState !== 'hidden') start();
    doc?.addEventListener?.('visibilitychange', sync);

    return () => {
        clear();
        doc?.removeEventListener?.('visibilitychange', sync);
    };
}
