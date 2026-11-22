// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function countCalls(target) {
    const counts = Object.create(null);
    const api = new Proxy(target, {
        get(proxiedTarget, name) {
            const value = Reflect.get(proxiedTarget, name, proxiedTarget);
            if (typeof value !== 'function') return value;

            return (...args) => {
                counts[name] = (counts[name] ?? 0) + 1;
                return Reflect.apply(value, proxiedTarget, args);
            };
        },
    });

    return {
        api,
        counts,
        total() {
            return Reflect.ownKeys(counts)
                .reduce((sum, name) => sum + counts[name], 0);
        },
        reset() {
            for (const name of Reflect.ownKeys(counts)) counts[name] = 0;
        },
    };
}
