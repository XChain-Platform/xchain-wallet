// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { registry as registryLib } from '../../../packages/core/src/index.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

let settings;
const publishHomeState = vi.fn();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/watch/watchHost.js', () => ({
    publishHomeState: (...args) => publishHomeState(...args),
}));

const { HomeTabs, unknownTokenKeys } = await import(
    '../../../packages/core/src/shared/components/HomeTabs.jsx'
);
const { buildBalanceRows } = await import(
    '../../../packages/core/src/shared/components/BalanceList.jsx'
);

const chainRegistry = registryLib.defaultRegistry();
const CHAIN = 'bitcoin-mainnet';
const noop = () => {};
const NO_KEYS = new Set();
const prices = { [CHAIN]: { price: 50000, sparkline: [1, 2, 3] } };
const messaging = { getNativePricesRequest: vi.fn(async () => ({ prices })) };

const balances = {
    [CHAIN]: [{
        address: 'bc1qa',
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [
                { tick: 'MYSTERY', quantity: '5', divisibility: 0 },
                { tick: 'HIDDEN', quantity: '7', divisibility: 0 },
            ],
        },
    }],
};

function tabs(props = {}) {
    return (
        <MessagingContext.Provider value={{ shell: 'web', messaging }}>
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={balances}
                balancesFetchedAt={1000}
                walletId="wallet-1"
                accountId="acct-1"
                networkFilter="all"
                tokenQuery=""
                coinFamilies={[]}
                pinnedKeys={NO_KEYS}
                hiddenKeys={NO_KEYS}
                onNetworkFilterChange={noop}
                onTokenQueryChange={noop}
                onReceive={noop}
                {...props}
            />
        </MessagingContext.Provider>
    );
}

const lastState = () => publishHomeState.mock.calls.at(-1)[0];
const keys = (rows) => rows.map((r) => `${r.chainId}:${r.tick}`).sort();

describe('HomeTabs publishes the watch state', () => {
    beforeEach(() => {
        settings = { fiatCurrency: 'USD', hideUnknownTokens: false, privacy: {} };
        publishHomeState.mockClear();
    });
    afterEach(cleanup);

    it('publishes the Home fields and the sparkline map', async () => {
        const pinned = new Set([`${CHAIN}:MYSTERY`]);
        render(tabs({ pinnedKeys: pinned, hideSmallBalances: true }));
        await vi.waitFor(() => expect(lastState().nativePriceMap).toEqual(prices));
        expect(lastState()).toMatchObject({
            walletId: 'wallet-1',
            accountId: 'acct-1',
            pinnedKeys: pinned,
            hideSmallBalances: true,
            balancesFetchedAt: 1000,
        });
        expect(keys(lastState().rows)).toEqual([`${CHAIN}:BTC`, `${CHAIN}:HIDDEN`, `${CHAIN}:MYSTERY`]);
    });

    it('publishes once per change and not again on a rerender with the same inputs', async () => {
        const view = render(tabs());
        await vi.waitFor(() => expect(lastState().nativePriceMap).toEqual(prices));
        const settled = publishHomeState.mock.calls.length;
        view.rerender(tabs());
        expect(publishHomeState).toHaveBeenCalledTimes(settled);
        view.rerender(tabs({ balancesFetchedAt: 2000 }));
        expect(publishHomeState).toHaveBeenCalledTimes(settled + 1);
        expect(lastState().balancesFetchedAt).toBe(2000);
    });

    it('drops hidden rows and ignores the network filter and the search query', async () => {
        render(tabs({
            hiddenKeys: new Set([`${CHAIN}:HIDDEN`]),
            networkFilter: 'doge',
            tokenQuery: 'nomatch',
        }));
        await vi.waitFor(() => expect(lastState().nativePriceMap).toEqual(prices));
        expect(keys(lastState().rows)).toEqual([`${CHAIN}:BTC`, `${CHAIN}:MYSTERY`]);
    });

    it('Hide unknown tokens drops the same rows as Home', async () => {
        settings = { ...settings, hideUnknownTokens: true };
        render(tabs());
        await vi.waitFor(() => expect(lastState().nativePriceMap).toEqual(prices));
        const home = unknownTokenKeys(buildBalanceRows(balances, chainRegistry), { pinnedKeys: new Set() });
        expect(home.size).toBeGreaterThan(0);
        const published = new Set(keys(lastState().rows));
        for (const key of home) expect(published.has(key)).toBe(false);
        expect(published.has(`${CHAIN}:BTC`)).toBe(true);
    });
});

describe('publishHomeState without a started watch host', () => {
    it('is a no-op', async () => {
        vi.resetModules();
        vi.doUnmock('../../../packages/core/src/watch/watchHost.js');
        const real = await import('../../../packages/core/src/watch/watchHost.js');
        expect(real.publishHomeState({ rows: [] })).toBeUndefined();
    });
});
