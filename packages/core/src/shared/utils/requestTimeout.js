// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const SCREEN_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Bounds a screen read even when the shell transport cannot cancel its work.
 * The original promise remains observed after the timeout, so a late rejection
 * does not become unhandled.
 *
 * @template T
 * @param {Promise<T>} request
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
export function withRequestTimeout(request, timeoutMs = SCREEN_REQUEST_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });
    return Promise.race([Promise.resolve(request), timeout])
        .finally(() => clearTimeout(timer));
}
