// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildActivityCheckConfig } from '../../../packages/core/src/notifications/activityCheckConfig.js';
import { clearTokenInfoCache } from '../../../packages/core/src/shared/utils/tokenInfoCache.js';
import {
    publishHomeState,
    startWatchHost,
    stopWatchHost,
} from '../../../packages/core/src/watch/watchHost.js';
import { createWatchIntents } from '../../../packages/core/src/watch/watchIntents.js';
import { countCalls } from '../../helpers/readCounter.js';

const NOW = 1_700_000_000_000;

const nativeTarget = () => ({
    Capacitor: { isNativePlatform: () => true },
});

function homeState(size) {
    const rows = Array.from({ length: size }, (_, index) => ({
        id: `bitcoin-mainnet:T${index}`,
        chainId: 'bitcoin-mainnet',
        tick: index === 0 ? 'BTC' : `T${index}`,
        kind: index === 0 ? 'native' : 'token',
        displayName: index === 0 ? 'Bitcoin' : `Token ${index}`,
        quantity: String((index + 1) * 100_000_000),
        pendingQuantity: '0',
        divisibility: 8,
        fiatRate: index + 1,
        change24hPct: 1,
        fiatRateSource: 'market',
        address: `bc1q-watch-${index}`,
        explorerBaseUrl: '/explorer',
        balances: { confirmed: String(index + 1), pending: '0' },
    }));
    rows[0].id = 'bitcoin-mainnet:BTC';

    return {
        walletId: 'wallet-1',
        accountId: 'account-1',
        rows,
        pinnedKeys: new Set(),
        hideSmallBalances: false,
        balancesFetchedAt: NOW - 1_000,
        nativePriceMap: {
            'bitcoin-mainnet': {
                change24hPct: 2,
                sparkline: Array.from({ length: 168 }, (_, index) => index + 1),
            },
        },
    };
}

function tokenInfo() {
    return {
        totalSupply: '1000000',
        divisibility: 8,
        locked: false,
        creator: 'bc1qcreator',
        description: 'Fresh token metadata',
    };
}

async function readCounts(size) {
    clearTokenInfoCache();
    const state = homeState(size);
    expect(Object.keys(state)).toEqual([
        'walletId',
        'accountId',
        'rows',
        'pinnedKeys',
        'hideSmallBalances',
        'balancesFetchedAt',
        'nativePriceMap',
    ]);

    const getTokenInfo = vi.fn(async () => tokenInfo());
    const explorer = countCalls({ getTokenInfo });
    const counts = {};
    const measure = async (name, action) => {
        const before = explorer.total();
        await action();
        counts[name] = explorer.total() - before;
    };

    const sendSnapshot = vi.fn(async () => true);
    await startWatchHost({
        target: nativeTarget(),
        bridge: {
            isAvailable: vi.fn(async () => true),
            sendSnapshot,
            sendImage: vi.fn(),
            sendDetail: vi.fn(),
            removeWatchData: vi.fn(),
        },
        now: () => NOW,
    });
    await measure('snapshot', async () => publishHomeState(state));
    expect(sendSnapshot).toHaveBeenCalledOnce();
    expect(sendSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        builtAt: NOW,
        balancesAt: state.balancesFetchedAt,
        rows: expect.any(Array),
    }));
    expect(sendSnapshot.mock.calls[0][0].rows).toHaveLength(size);
    stopWatchHost();

    const sendDetail = vi.fn(async () => true);
    const intents = createWatchIntents({
        getRows: () => state.rows,
        getDetailOptions: () => ({ nativePriceMap: state.nativePriceMap }),
        getTokenInfo: explorer.api.getTokenInfo,
        sendDetail,
        refresh: vi.fn(async () => {}),
        markRead: vi.fn(async () => {}),
        openOnPhone: vi.fn(async () => {}),
    });

    await measure('chart', async () => {
        await expect(intents.route('detailRequest', { tokenId: state.rows[0].id }))
            .resolves.toBe(true);
    });
    expect(sendDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        tokenId: state.rows[0].id,
        chart: { points: expect.any(Array), up: true },
    }));
    expect(sendDetail.mock.calls.at(-1)[0].chart.points).toHaveLength(48);

    const tokenRow = state.rows.at(-1);
    await measure('detail', async () => {
        await expect(intents.route('detailRequest', { tokenId: tokenRow.id }))
            .resolves.toBe(true);
    });
    expect(getTokenInfo).toHaveBeenCalledOnce();
    expect(getTokenInfo).toHaveBeenCalledWith({
        chainId: tokenRow.chainId,
        tick: tokenRow.tick,
        demo: false,
    });

    await measure('config', async () => {
        const config = buildActivityCheckConfig({
            ...state,
            entries: state.rows,
            settings: { watch: { backgroundActivityCheck: true } },
            translate: (key) => key,
            demoWallet: () => false,
        });
        expect(config.targets).toHaveLength(size);
    });

    return { counts, total: explorer.total() };
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fetch'); }));
});

afterEach(() => {
    stopWatchHost();
    clearTokenInfoCache();
    vi.unstubAllGlobals();
});

describe('watch data-access read counts', () => {
    it('keeps snapshot, W2, and activity-config reads constant from 5 to 50 rows', async () => {
        const five = await readCounts(5);
        const fifty = await readCounts(50);

        expect(five.counts).toEqual({
            snapshot: 0,
            chart: 0,
            detail: 1,
            config: 0,
        });
        expect(fifty.counts).toEqual(five.counts);
        expect(five.total).toBe(1);
        expect(fifty.total).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
    });
});
