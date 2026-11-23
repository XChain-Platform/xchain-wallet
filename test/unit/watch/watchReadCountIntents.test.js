// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildActivityCheckConfig,
    startActivityCheckSync,
} from '../../../packages/core/src/notifications/activityCheckConfig.js';
import {
    clearTokenInfoCache,
    tokenInfoCacheKey,
    writeTokenInfoCache,
} from '../../../packages/core/src/shared/utils/tokenInfoCache.js';
import { createWatchIntents } from '../../../packages/core/src/watch/watchIntents.js';
import { countCalls } from '../../helpers/readCounter.js';

let originalFetch;
let fetchStub;

function buildRows(size) {
    return [
        ...Array.from({ length: size }, (_, index) => ({
            id: `bitcoin-testnet:T${index}`,
            kind: 'token',
            chainId: 'bitcoin-testnet',
            tick: `T${index}`,
            change24hPct: 1,
            fiatRateSource: 'market',
        })),
        {
            id: 'bitcoin-testnet:BTC',
            kind: 'native',
            chainId: 'bitcoin-testnet',
            tick: 'BTC',
        },
    ];
}

function tokenInfo(description) {
    return {
        totalSupply: '1000',
        divisibility: 2,
        locked: false,
        creator: 'tb1qcreator',
        description,
    };
}

async function readCountsForSize(size) {
    clearTokenInfoCache();
    const rows = buildRows(size);
    const tokenRows = rows.filter(({ kind }) => kind === 'token');
    const nativeRow = rows.at(-1);
    const getTokenInfo = vi.fn(async () => tokenInfo('Fresh metadata'));
    const explorer = countCalls({ getTokenInfo });
    const sendDetail = vi.fn(async () => true);
    const dependencies = {
        getRows: () => rows,
        getDetailOptions: () => ({
            nativePriceMap: {
                'bitcoin-testnet': {
                    sparkline: Array.from({ length: 24 }, (_, index) => index + 1),
                },
            },
        }),
        getTokenInfo: explorer.api.getTokenInfo,
        sendDetail,
        refresh: vi.fn(async () => {}),
        markRead: vi.fn(async () => {}),
        openOnPhone: vi.fn(async () => {}),
        onWatchState: vi.fn(async () => {}),
    };
    const intents = createWatchIntents(dependencies);
    const counts = {};
    const measure = async (name, action) => {
        const before = explorer.total();
        await action();
        counts[name] = explorer.total() - before;
    };

    const cachedRow = tokenRows[0];
    writeTokenInfoCache(tokenInfoCacheKey(cachedRow.chainId, cachedRow.tick), tokenInfo('Cached metadata'));
    await measure('cachedDetail', async () => {
        await expect(intents.route('detailRequest', { tokenId: cachedRow.id })).resolves.toBe(true);
    });
    expect(sendDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        tokenId: cachedRow.id,
        description: 'Cached metadata',
    }));

    await measure('nativeDetail', async () => {
        await expect(intents.route('detailRequest', { tokenId: nativeRow.id })).resolves.toBe(true);
    });
    expect(sendDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        tokenId: nativeRow.id,
        chart: expect.objectContaining({ points: expect.any(Array) }),
    }));
    expect(sendDetail.mock.calls.at(-1)[0].chart.points).toHaveLength(24);

    const uncachedRow = tokenRows.at(-1);
    await measure('uncachedDetail', async () => {
        await expect(intents.route('detailRequest', { tokenId: uncachedRow.id })).resolves.toBe(true);
    });
    expect(getTokenInfo).toHaveBeenCalledOnce();
    expect(getTokenInfo).toHaveBeenCalledWith({
        chainId: uncachedRow.chainId,
        tick: uncachedRow.tick,
        demo: false,
    });

    await measure('refresh', async () => {
        await expect(intents.route('refresh', {})).resolves.toBe(true);
    });
    await measure('markRead', async () => {
        await expect(intents.route('markRead', { id: 'alert-1' })).resolves.toBe(true);
    });
    await measure('openOnPhone', async () => {
        await expect(intents.route('openOnPhone', { route: '/activity' })).resolves.toBe(true);
    });
    await measure('watchState', async () => {
        await expect(intents.route('watchState', { appVersion: '1.0.0' })).resolves.toBe(true);
    });

    const entries = Array.from({ length: size }, (_, index) => ({
        address: `address-${index}`,
        explorerBaseUrl: '/explorer',
        balances: { confirmed: `${index + 1}`, pending: '0' },
    }));
    const activityState = {
        walletId: 'wallet-1',
        settings: { watch: { backgroundActivityCheck: true } },
        entries,
        translate: (key) => key,
        demoWallet: () => false,
    };
    const setActivityCheck = vi.fn(async () => true);
    const getNativePlugin = vi.fn((name) => (
        name === 'XChainActivity' ? { setActivityCheck } : null
    ));
    const target = new EventTarget();

    await measure('activityCheck', async () => {
        const built = buildActivityCheckConfig(activityState);
        expect(built.targets).toHaveLength(size);

        const stop = startActivityCheckSync({
            target,
            getNativePlugin,
            readState: () => activityState,
        });
        for (const eventName of [
            'xc:session-changed',
            'xc:settings-changed',
            'xc:home-balances-published',
        ]) {
            target.dispatchEvent(new Event(eventName));
        }
        await vi.waitFor(() => expect(setActivityCheck).toHaveBeenCalledTimes(4));
        stop();
    });

    expect(getNativePlugin).toHaveBeenCalledWith(
        'XChainActivity',
        { method: 'setActivityCheck' },
    );
    const lastConfig = JSON.parse(setActivityCheck.mock.calls.at(-1)[0].json);
    expect(lastConfig.targets).toHaveLength(size);
    expect(fetchStub).not.toHaveBeenCalled();

    return { counts, explorerCalls: explorer.total() };
}

beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchStub = vi.fn(async () => { throw new Error('Unexpected fetch'); });
    globalThis.fetch = fetchStub;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    clearTokenInfoCache();
});

describe('watch intent read counts', () => {
    it('keeps 5-row and 50-row intent reads constant and activity sync read-free', async () => {
        const five = await readCountsForSize(5);
        const fifty = await readCountsForSize(50);

        expect(five.counts).toEqual({
            cachedDetail: 0,
            nativeDetail: 0,
            uncachedDetail: 1,
            refresh: 0,
            markRead: 0,
            openOnPhone: 0,
            watchState: 0,
            activityCheck: 0,
        });
        expect(fifty.counts).toEqual(five.counts);
        expect(five.explorerCalls).toBe(1);
        expect(fifty.explorerCalls).toBe(1);
        expect(fetchStub).not.toHaveBeenCalled();
    });
});
