// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildWatchDetail } from './buildWatchDetail.js';
import { validateMessage } from './contract/index.js';
import { createSingleFlight } from './watchSingleFlight.js';

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

export function createWatchIntents({
    getRows,
    getDetailOptions = () => ({}),
    getTokenInfo,
    sendDetail,
    refresh,
    markRead,
    openOnPhone,
    onWatchState = () => {},
}) {
    let watchState = null;
    const details = createSingleFlight(async (tokenId) => {
        const row = getRows().find((candidate) => candidate.id === tokenId);
        if (!row) return;

        const options = getDetailOptions() || {};
        let detail = buildWatchDetail(row, options);
        if (!detail && row.kind !== 'native' && typeof getTokenInfo === 'function') {
            const tokenInfo = await getTokenInfo({
                chainId: row.chainId,
                tick: row.tick,
                demo: options.demo === true,
            });
            detail = buildWatchDetail(row, { ...options, tokenInfo });
        }
        if (detail) await sendDetail(detail);
    });
    const handlers = {
        refresh: () => refresh(),
        detailRequest: ({ tokenId }) => details.get(tokenId),
        markRead: ({ id }) => markRead(id),
        openOnPhone: ({ route }) => openOnPhone(route),
        async watchState(next) {
            watchState = { ...next };
            await onWatchState(watchState);
        },
    };
    const route = (kind, value) => routeWatchIntent(kind, value, handlers, {
        validate: validateMessage,
    });

    return {
        route,
        handle: (message) => route(message?.kind, message?.value),
        getWatchState: () => watchState,
    };
}
