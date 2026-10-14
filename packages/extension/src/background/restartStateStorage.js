// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Store a bounded watcher's string markers in chrome.storage.local so a
 * service-worker replacement resumes its delivery state before polling.
 *
 * @param {string} key
 * @param {{ get: Function, set: Function } | null | undefined} [area]
 */
export function createRestartStringSetStorage(
    key,
    area = globalThis.chrome?.storage?.local,
) {
    if (typeof key !== 'string' || !key) {
        throw new TypeError('createRestartStringSetStorage: key is required');
    }

    return {
        async load() {
            if (!area?.get) return [];
            const stored = await area.get(key);
            const values = stored?.[key];
            return Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value) : [];
        },
        async save(values) {
            if (!area?.set) return;
            await area.set({
                [key]: Array.isArray(values)
                    ? values.filter((value) => typeof value === 'string' && value)
                    : [],
            });
        },
    };
}
