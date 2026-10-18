// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the §46 NotificationService. The SDK is mocked as a
// callback capturer (onAddress stores the handler so the test can emit
// explorer events into it); the notify adapter is a spy; settings flags
// are a mutable object so a test can flip a toggle and re-emit.

import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';
import {
    readBalanceCache,
    writeBalanceCache,
} from '../../../packages/core/src/shared/utils/balanceCache.js';
import {
    readHistoryCache,
    writeHistoryCache,
} from '../../../packages/core/src/shared/utils/historyCache.js';

/** Drain microtasks + the timer queue so async handlers settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeSdk() {
    /** @type {Record<string, Function[]>} address -> handlers */
    const handlers = {};
    return {
        connectWs: vi.fn(async () => {}),
        disconnectWs: vi.fn(() => {}),
        onAddress: vi.fn((address, cb) => {
            (handlers[address] = handlers[address] || []).push(cb);
            return () => {
                handlers[address] = (handlers[address] || []).filter((h) => h !== cb);
            };
        }),
        emit(address, msg) {
            for (const cb of handlers[address] || []) cb(msg);
        },
        subCount(address) {
            return (handlers[address] || []).length;
        },
    };
}

function makeDeps(overrides = {}) {
    const settings = {
        activeNetwork: 'mainnet',
        notifications: {
            txConfirmations: true,
            incomingReceipts: true,
            dispenserFills: true,
            orderFills: true,
            priceAlerts: true,
            messages: true,
        },
    };
    const addresses = [
        { address: 'addrBTC', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' },
    ];
    const sdks = { 'bitcoin-mainnet': makeSdk() };
    const notify = vi.fn(async () => {});
    let clock = 1000;
    const deps = {
        settings,
        addresses,
        sdks,
        notify,
        setClock: (v) => { clock = v; },
        getActiveAddresses: vi.fn(async () => addresses),
        getSdkForChain: (chainId) => sdks[chainId],
        getSettings: async () => settings,
        notifyAdapter: notify,
        now: () => clock,
        ...overrides,
    };
    return deps;
}

function makeService(deps, extra = {}) {
    return new NotificationService({
        getActiveAddresses: deps.getActiveAddresses,
        getSdkForChain: deps.getSdkForChain,
        getSettings: deps.getSettings,
        notify: deps.notifyAdapter,
        now: deps.now,
        ...extra,
    });
}

describe('NotificationService', () => {
    it('keeps persisted portfolio snapshots isolated by active network', () => {
        localStorage.clear();
        const mainBalances = { 'bitcoin-mainnet': [{ address: 'main-address' }] };
        const regtestBalances = { 'bitcoin-regtest': [{ address: 'regtest-address' }] };
        writeBalanceCache('network-wallet', 'account', {
            balances: mainBalances, fetchedAt: 1,
        }, 'mainnet');
        writeBalanceCache('network-wallet', 'account', {
            balances: regtestBalances, fetchedAt: 2,
        }, 'regtest');

        const mainHistory = {
            entries: [{ chainId: 'bitcoin-mainnet' }],
            addressesByChain: { 'bitcoin-mainnet': [{ address: 'main-address' }] },
            fetchedAt: 3,
        };
        const regtestHistory = {
            entries: [{ chainId: 'bitcoin-regtest' }],
            addressesByChain: { 'bitcoin-regtest': [{ address: 'regtest-address' }] },
            fetchedAt: 4,
        };
        writeHistoryCache('network-wallet', 'account', mainHistory, 'mainnet');
        writeHistoryCache('network-wallet', 'account', regtestHistory, 'regtest');

        expect(readBalanceCache('network-wallet', 'account', 'mainnet')?.balances)
            .toEqual(mainBalances);
        expect(readBalanceCache('network-wallet', 'account', 'regtest')?.balances)
            .toEqual(regtestBalances);
        expect(readHistoryCache('network-wallet', 'account', 'mainnet')).toEqual(mainHistory);
        expect(readHistoryCache('network-wallet', 'account', 'regtest')).toEqual(regtestHistory);
        expect(readBalanceCache('network-wallet', 'account', 'testnet')).toBeNull();
        expect(readHistoryCache('network-wallet', 'account', 'testnet')).toBeNull();
    });

    it('ignores an older address lookup after a network refresh starts', async () => {
        let resolveOld;
        const oldLookup = new Promise((resolve) => { resolveOld = resolve; });
        const mainSdk = makeSdk();
        const regtestSdk = makeSdk();
        const networkSdks = {
            'bitcoin-mainnet': mainSdk,
            'bitcoin-regtest': regtestSdk,
        };
        const deps = makeDeps({
            sdks: networkSdks,
            getSdkForChain: (chainId) => networkSdks[chainId],
            getActiveAddresses: vi.fn()
                .mockReturnValueOnce(oldLookup)
                .mockResolvedValueOnce([{
                    address: 'regtest-address',
                    chainId: 'bitcoin-regtest',
                    label: 'Bitcoin Regtest',
                    network: 'regtest',
                }]),
        });
        const service = makeService(deps);

        const starting = service.start();
        await service.refresh();
        resolveOld([{
            address: 'main-address',
            chainId: 'bitcoin-mainnet',
            label: 'Bitcoin',
            network: 'mainnet',
        }]);
        await starting;

        expect(mainSdk.onAddress).not.toHaveBeenCalled();
        expect(regtestSdk.onAddress).toHaveBeenCalledWith(
            'regtest-address',
            expect.any(Function),
        );
    });

    it('ignores events from a subscription on the previous network', async () => {
        const deps = makeDeps();
        const service = makeService(deps);
        await service.start();
        deps.settings.activeNetwork = 'regtest';

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 10, source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();

        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('start() connects each chain once and subscribes per address', async () => {
        const deps = makeDeps({});
        deps.addresses.push({ address: 'addrBTC2', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' });
        deps.sdks['litecoin-mainnet'] = makeSdk();
        deps.addresses.push({ address: 'addrLTC', chainId: 'litecoin-mainnet', label: 'Litecoin', network: 'mainnet' });

        const svc = makeService(deps);
        await svc.start();

        expect(deps.sdks['bitcoin-mainnet'].connectWs).toHaveBeenCalledTimes(1);
        expect(deps.sdks['litecoin-mainnet'].connectWs).toHaveBeenCalledTimes(1);
        expect(deps.sdks['bitcoin-mainnet'].onAddress).toHaveBeenCalledTimes(2);
        expect(deps.sdks['litecoin-mainnet'].onAddress).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['testnet', 'bitcoin-testnet'],
        ['regtest', 'bitcoin-regtest'],
    ])('retries a failed %s socket once per chain with backoff', async (_network, chainId) => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const deps = makeDeps({ now: () => Date.now() });
        const sdk = makeSdk();
        sdk.connectWs.mockRejectedValueOnce(new Error('endpoint unavailable'));
        deps.addresses.splice(0, 1,
            { address: 'addr1', chainId, label: 'Bitcoin', network: _network },
            { address: 'addr2', chainId, label: 'Bitcoin', network: _network },
        );
        deps.sdks[chainId] = sdk;

        const svc = makeService(deps, { logger });
        try {
            await svc.start();
            await svc.refresh();
            expect(sdk.connectWs).toHaveBeenCalledTimes(1);
            expect(sdk.onAddress).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(999);
            expect(sdk.connectWs).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);

            expect(sdk.connectWs).toHaveBeenCalledTimes(2);
            expect(sdk.onAddress).toHaveBeenCalledTimes(2);
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        } finally {
            svc.stop();
            vi.useRealTimers();
        }
    });

    it('caps failed socket attempts and emits one sanitized warning', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const deps = makeDeps({ now: () => Date.now() });
        deps.addresses.push({ address: 'addrBTC2', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' });
        deps.sdks['bitcoin-mainnet'].connectWs.mockRejectedValue(
            new Error('password=hunter2 body={"address":"addrBTC"}'),
        );

        const svc = makeService(deps, { logger });
        try {
            await svc.start();
            await vi.advanceTimersByTimeAsync(1_000);
            await vi.advanceTimersByTimeAsync(2_000);
            await vi.advanceTimersByTimeAsync(60_000);
            await svc.refresh();

            expect(deps.sdks['bitcoin-mainnet'].connectWs).toHaveBeenCalledTimes(3);
            expect(deps.sdks['bitcoin-mainnet'].onAddress).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.warn.mock.calls[0][0]).toMatch(/^\[notify\] NotificationService: WebSocket unavailable/);
            expect(logger.warn.mock.calls[0][1]).toBe('<Error>');
            expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/addrBTC|hunter2|body=/);
            expect(logger.error).not.toHaveBeenCalled();
        } finally {
            svc.stop();
            vi.useRealTimers();
        }
    });

    it('stop() unsubscribes everything and disconnects each chain', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();
        expect(deps.sdks['bitcoin-mainnet'].subCount('addrBTC')).toBe(1);

        svc.stop();
        expect(deps.sdks['bitcoin-mainnet'].subCount('addrBTC')).toBe(0);
        expect(deps.sdks['bitcoin-mainnet'].disconnectWs).toHaveBeenCalledTimes(1);
    });

    it('fires an incoming-receipt for inbound NEW_ACTION when the flag is on', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 11, source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();

        expect(deps.notify).toHaveBeenCalledTimes(1);
        expect(deps.notify.mock.calls[0][0]).toMatchObject({ kind: 'incoming-receipt' });
    });

    it('suppresses incoming receipts when the flag is off', async () => {
        const deps = makeDeps();
        deps.settings.notifications.incomingReceipts = false;
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 12, source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();

        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('fires an incoming-message for an inbound MESSAGE action when the flag is on', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 13, action: 'MESSAGE', source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();

        // A MESSAGE is its own kind, not a generic incoming-receipt.
        expect(deps.notify).toHaveBeenCalledTimes(1);
        expect(deps.notify.mock.calls[0][0]).toMatchObject({ kind: 'incoming-message' });
    });

    it('suppresses incoming messages when the flag is off (and does not fall back to a receipt)', async () => {
        const deps = makeDeps();
        deps.settings.notifications.messages = false;
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 14, action: 'MESSAGE', source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();

        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('fires tx-confirmed for our own broadcast tx and flips the pending record', async () => {
        const deps = makeDeps();
        const onTxConfirmed = vi.fn(async () => {});
        const svc = makeService(deps, {
            getPendingTxids: async () => new Set(['txOurs']),
            onTxConfirmed,
        });
        await svc.start();

        // not ours → ignored
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 20, source: 'addrBTC', tx_hash: 'txOther' },
        });
        await flush();
        expect(deps.notify).not.toHaveBeenCalled();

        // ours → fires + callback
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 21, source: 'addrBTC', tx_hash: 'txOurs' },
        });
        await flush();
        expect(deps.notify).toHaveBeenCalledTimes(1);
        expect(deps.notify.mock.calls[0][0]).toMatchObject({ kind: 'tx-confirmed' });
        expect(onTxConfirmed).toHaveBeenCalledWith('txOurs');
    });

    it('records our confirmed transaction without notifying when tx confirmations are off', async () => {
        const deps = makeDeps();
        deps.settings.notifications.txConfirmations = false;
        const onTxConfirmed = vi.fn(async () => {});
        const svc = makeService(deps, {
            getPendingTxids: async () => new Set(['txOurs']),
            onTxConfirmed,
        });
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 22, source: 'addrBTC', tx_hash: 'txOurs' },
        });
        await flush();

        expect(onTxConfirmed).toHaveBeenCalledWith('txOurs');
        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('fires order-fill on ORDER_MATCH, suppressed when orderFills is off', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();

        deps.settings.notifications.orderFills = false;
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', { type: 'ORDER_MATCH', data: { action_index: 30 } });
        await flush();
        expect(deps.notify).not.toHaveBeenCalled();

        deps.settings.notifications.orderFills = true;
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', { type: 'ORDER_MATCH', data: { action_index: 31 } });
        await flush();
        expect(deps.notify).toHaveBeenCalledTimes(1);
        expect(deps.notify.mock.calls[0][0]).toMatchObject({ kind: 'order-fill' });
    });

    it('suppresses dispenser fills when dispenserFills is off', async () => {
        const deps = makeDeps();
        deps.settings.notifications.dispenserFills = false;
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'DISPENSE',
            data: { action_index: 32 },
        });
        await flush();

        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('suppresses CoinPay-required prompts when incoming receipts are off', async () => {
        const deps = makeDeps();
        deps.settings.notifications.incomingReceipts = false;
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'COINPAY_REQUIRED',
            data: { action_index: 33 },
        });
        await flush();

        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('dedupes the same event within the 30s window', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();

        const ev = { type: 'DISPENSE', data: { action_index: 40 } };
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', ev);
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', ev);
        await flush();
        expect(deps.notify).toHaveBeenCalledTimes(1);

        // past the TTL → fires again
        deps.setClock(1000 + 31_000);
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', ev);
        await flush();
        expect(deps.notify).toHaveBeenCalledTimes(2);
    });

    it('never notifies on catch_up (historical replay) events', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            catch_up: true,
            data: { action_index: 50, source: 'x', destination: 'addrBTC' },
        });
        await flush();
        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('no-ops on unknown / priceAlerts-only event types without throwing', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', { type: 'NETWORK_STATS', data: { block_height: 1 } });
        deps.sdks['bitcoin-mainnet'].emit('addrBTC', { type: 'SOMETHING_NEW', data: {} });
        await flush();
        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('suppresses delivery during quiet hours', async () => {
        const deps = makeDeps();
        // Window spans the whole day except one minute, so it's guaranteed
        // to contain "now" regardless of when the test runs, with no clock
        // mocking required.
        deps.settings.quietHours = { enabled: true, start: '00:00', end: '23:59' };
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 60, source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();
        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('delivers normally when quiet hours is present but disabled', async () => {
        const deps = makeDeps();
        deps.settings.quietHours = { enabled: false, start: '00:00', end: '23:59' };
        const svc = makeService(deps);
        await svc.start();

        deps.sdks['bitcoin-mainnet'].emit('addrBTC', {
            type: 'NEW_ACTION',
            data: { action_index: 61, source: 'someoneElse', destination: 'addrBTC' },
        });
        await flush();
        expect(deps.notify).toHaveBeenCalledTimes(1);
    });

    it('refresh() subscribes to a newly-added address', async () => {
        const deps = makeDeps();
        const svc = makeService(deps);
        await svc.start();
        expect(deps.sdks['bitcoin-mainnet'].onAddress).toHaveBeenCalledTimes(1);

        deps.addresses.push({ address: 'addrBTC2', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' });
        await svc.refresh();
        expect(deps.sdks['bitcoin-mainnet'].onAddress).toHaveBeenCalledTimes(2);
        expect(deps.sdks['bitcoin-mainnet'].subCount('addrBTC2')).toBe(1);
    });

    it('tags subscription failures without logging addresses or error payloads', async () => {
        const deps = makeDeps();
        const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        deps.sdks['bitcoin-mainnet'].onAddress.mockImplementation(() => {
            throw new Error('password=hunter2 body={"address":"addrBTC","balance":42}');
        });

        const svc = makeService(deps, { logger });
        await svc.start();

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/^\[notify\] /);
        expect(logger.error.mock.calls[0][1]).toBe('<Error>');
        expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/addrBTC|hunter2|balance|body=/);
    });
});
