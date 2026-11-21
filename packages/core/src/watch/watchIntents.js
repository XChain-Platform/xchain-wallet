// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export async function routeWatchIntent(kind, value, handlers, { validate = () => true } = {}) {
    const allowedKinds = ['refresh', 'detailRequest', 'openOnPhone', 'markRead', 'watchState'];
    if (!allowedKinds.includes(kind) || value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (handlers === null || (typeof handlers !== 'object' && typeof handlers !== 'function')) return false;

    try {
        if (!Object.hasOwn(handlers, kind)) return false;
        const handler = handlers[kind];
        if (typeof handler !== 'function') return false;
        if (!validate(kind, value)) return false;
        await handler.call(handlers, value);
        return true;
    } catch {
        return false;
    }
}
