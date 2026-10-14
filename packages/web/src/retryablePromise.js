// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Share one pending or fulfilled load. A rejected load clears its cache so a
 * later caller can retry transient work such as fetching a dynamic chunk.
 *
 * @template T
 * @param {() => Promise<T>} loader
 * @returns {() => Promise<T>}
 */
export function memoizeRetryablePromise(loader) {
    let cached;
    return () => {
        if (!cached) {
            const pending = loader();
            const retryable = pending.catch((error) => {
                if (cached === retryable) cached = undefined;
                throw error;
            });
            cached = retryable;
        }
        return cached;
    };
}
