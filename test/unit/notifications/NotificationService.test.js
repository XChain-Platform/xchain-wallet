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
});
