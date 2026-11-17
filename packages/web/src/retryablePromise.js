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

export const CHUNK_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);

const waitFor = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Run transient asynchronous work again after each bounded backoff. The
 * initial call happens immediately; every entry in `delays` permits one more
 * attempt after that delay.
 *
 * @template T
 * @param {() => Promise<T>} loader
 * @param {{ delays?: readonly number[], wait?: (delayMs: number) => Promise<void> }} [opts]
 * @returns {Promise<T>}
 */
export async function retryPromise(loader, {
    delays = CHUNK_RETRY_DELAYS_MS,
    wait = waitFor,
} = {}) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await loader();
        } catch (error) {
            if (attempt >= delays.length) throw error;
            await wait(delays[attempt]);
        }
    }
}
