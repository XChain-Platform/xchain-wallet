// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearTokenInfoCache,
    tokenInfoCacheKey,
    writeTokenInfoCache,
} from '../../../packages/core/src/shared/utils/tokenInfoCache.js';
import { createWatchIntents } from '../../../packages/core/src/watch/watchIntents.js';

const tokenRow = {
    id: 'bitcoin-mainnet:XC',
    kind: 'token',
    chainId: 'bitcoin-mainnet',
    tick: 'XC',
    change24hPct: 2.5,
    fiatRateSource: 'market',
};

function deferred() {
    let resolve;
    const promise = new Promise((onResolve) => { resolve = onResolve; });
    return { promise, resolve };
}

function setup(overrides = {}) {
    const dependencies = {
        getRows: vi.fn(() => [tokenRow]),
        getDetailOptions: vi.fn(() => ({})),
        getTokenInfo: vi.fn(async () => null),
        sendDetail: vi.fn(async () => true),
        refresh: vi.fn(async () => {}),
        markRead: vi.fn(async () => {}),
        openOnPhone: vi.fn(async () => {}),
        onWatchState: vi.fn(async () => {}),
        ...overrides,
    };
    return { dependencies, intents: createWatchIntents(dependencies) };
}

afterEach(() => clearTokenInfoCache());

describe('createWatchIntents', () => {
    it('routes refresh and rejects messages outside the intent contract', async () => {
        const { dependencies, intents } = setup();

        await expect(intents.handle({ kind: 'refresh', value: {} })).resolves.toBe(true);
        await expect(intents.handle({ kind: 'refresh', value: { extra: true } })).resolves.toBe(false);
        await expect(intents.handle({ kind: 'approve', value: {} })).resolves.toBe(false);

        expect(dependencies.refresh).toHaveBeenCalledOnce();
    });

    it('builds detail from cache without an explorer read', async () => {
        writeTokenInfoCache(tokenInfoCacheKey(tokenRow.chainId, tokenRow.tick), {
            totalSupply: '1000',
            divisibility: 2,
            locked: false,
            creator: 'xc1qcreator',
            description: 'Cached metadata',
        });
        const { dependencies, intents } = setup();

        await expect(intents.route('detailRequest', { tokenId: tokenRow.id })).resolves.toBe(true);

        expect(dependencies.getTokenInfo).not.toHaveBeenCalled();
        expect(dependencies.sendDetail).toHaveBeenCalledWith(expect.objectContaining({
            v: 1,
            tokenId: tokenRow.id,
            description: 'Cached metadata',
        }));
    });

    it('reads only the requested token once on a cache miss', async () => {
        const pending = deferred();
        const otherRow = { ...tokenRow, id: 'bitcoin-mainnet:OTHER', tick: 'OTHER' };
        const getTokenInfo = vi.fn(() => pending.promise);
        const { dependencies, intents } = setup({
            getRows: () => [otherRow, tokenRow],
            getTokenInfo,
        });

        const first = intents.route('detailRequest', { tokenId: tokenRow.id });
        const second = intents.route('detailRequest', { tokenId: tokenRow.id });
        await vi.waitFor(() => expect(getTokenInfo).toHaveBeenCalledOnce());
        expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: tokenRow.chainId,
            tick: tokenRow.tick,
            demo: false,
        });

        pending.resolve({
            totalSupply: '2000',
            divisibility: 2,
            locked: true,
            creator: 'xc1qfresh',
            description: 'Fresh metadata',
        });
        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(dependencies.sendDetail).toHaveBeenCalledOnce();
        expect(dependencies.sendDetail).toHaveBeenCalledWith(expect.objectContaining({
            tokenId: tokenRow.id,
            description: 'Fresh metadata',
        }));
    });

    it('does not read for an unknown token or a native detail cache miss', async () => {
        const nativeRow = {
            id: 'native:btc',
            kind: 'native',
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
        };
        const { dependencies, intents } = setup({ getRows: () => [nativeRow] });

        await intents.route('detailRequest', { tokenId: 'missing' });
        await intents.route('detailRequest', { tokenId: nativeRow.id });

        expect(dependencies.getTokenInfo).not.toHaveBeenCalled();
        expect(dependencies.sendDetail).not.toHaveBeenCalled();
    });

    it('routes inbox ids and phone routes without forwarding envelopes', async () => {
        const { dependencies, intents } = setup();

        await intents.handle({ kind: 'markRead', value: { id: 'alert-1' } });
        await intents.handle({ kind: 'openOnPhone', value: { route: '/review/request-1' } });

        expect(dependencies.markRead).toHaveBeenCalledWith('alert-1');
        expect(dependencies.openOnPhone).toHaveBeenCalledWith('/review/request-1');
    });

    it('stores watch state and publishes each accepted change', async () => {
        const { dependencies, intents } = setup();

        expect(intents.getWatchState()).toBeNull();
        await expect(intents.handle({
            kind: 'watchState',
            value: { appVersion: '1.2.3' },
        })).resolves.toBe(true);

        expect(intents.getWatchState()).toEqual({ appVersion: '1.2.3' });
        expect(dependencies.onWatchState).toHaveBeenCalledWith({ appVersion: '1.2.3' });
    });
});
