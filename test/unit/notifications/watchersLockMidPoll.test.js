// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A watcher stopped by a lock while a network read is pending delivers nothing
// when the read returns: a locked wallet shows no notification.

import { describe, expect, it, vi } from 'vitest';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';
import { DeadlineWatcher } from '../../../packages/core/src/notifications/DeadlineWatcher.js';

const ADDRESSES = async () => [{ chainId: 'bitcoin-regtest', address: 'bcrt1qmine', label: 'BTC regtest' }];

function gate() {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
}

async function stopMidPoll(watcher, pending) {
    const poll = watcher.pollOnce();
    await vi.waitFor(() => expect(pending.reached).toBe(true));
    watcher.stop();
    pending.gate.release();
    await poll;
}

describe('watchers stopped while a read is pending', () => {
    it('governance polls deliver nothing after stop', async () => {
        const pending = { gate: gate(), reached: false, hold: false };
        let polls = [];
        const notify = vi.fn();
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: ADDRESSES,
            getSdkForChain: () => ({
                getPolls: async () => polls,
                getBalances: async () => {
                    if (pending.hold) {
                        pending.reached = true;
                        await pending.gate.promise;
                    }
                    return [{ tick: 'GOV', quantity: '5' }];
                },
            }),
            getSettings: async () => ({ notifications: { governancePolls: true } }),
            notify,
            intervalMs: 1e9,
        });
        await watcher.pollOnce();
        polls = [{ action_index: 7, tick: 'GOV' }];
        pending.hold = true;
        await stopMidPoll(watcher, pending);
        expect(notify).not.toHaveBeenCalled();
    });

    it('dispenser escrow alerts deliver nothing after stop', async () => {
        const pending = { gate: gate(), reached: false };
        const notify = vi.fn();
        const watcher = new DispenserEscrowWatcher({
            getActiveAddresses: ADDRESSES,
            getSdkForChain: () => ({
                getDispensers: async () => ({
                    data: [{ action_index: '2592', status: 'valid', give_amount: '10', give_tick: 'XCHAIN' }],
                }),
                getAction: async () => {
                    pending.reached = true;
                    await pending.gate.promise;
                    return { state: { give_remaining: '25', status: 'open' } };
                },
            }),
            getSettings: async () => ({ notifications: {} }),
            notify,
            intervalMs: 1e9,
        });
        await stopMidPoll(watcher, pending);
        expect(notify).not.toHaveBeenCalled();
    });

    it('deadline alerts deliver nothing after stop', async () => {
        const pending = { gate: gate(), reached: false };
        const now = 1785117541;
        const notify = vi.fn();
        const watcher = new DeadlineWatcher({
            getActiveAddresses: ADDRESSES,
            getSdkForChain: () => ({
                explorer: { coin: 'RBTC' },
                getStatus: async () => ({ last_block_time: { RBTC: now }, chain_tip: { RBTC: 5000 } }),
                getOrders: async () => {
                    pending.reached = true;
                    await pending.gate.promise;
                    return { data: [{ action_index: '100', status: 'valid', order_status: 'open', expiration: now + 3600 }] };
                },
                getSwaps: async () => ({ data: [] }),
                getDispensers: async () => ({ data: [] }),
                getAction: async () => null,
                getPolls: async () => ({ data: [] }),
                getVotes: async () => ({ data: [] }),
            }),
            getSettings: async () => ({ notifications: {} }),
            coinForChain: () => 'bitcoin',
            notify,
            intervalMs: 1e9,
        });
        await stopMidPoll(watcher, pending);
        expect(notify).not.toHaveBeenCalled();
    });
});

describe('watchers stopped mid-poll keep the stored seen-state', () => {
    it('governance does not save an empty seen-state after stop', async () => {
        const pending = { gate: gate(), reached: false, hold: false };
        let polls = [{ action_index: 3, tick: 'OTHER' }];
        const saveSeen = vi.fn();
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: ADDRESSES,
            getSdkForChain: () => ({
                getPolls: async () => polls,
                getBalances: async () => {
                    if (pending.hold) {
                        pending.reached = true;
                        await pending.gate.promise;
                    }
                    return [{ tick: 'GOV', quantity: '5' }];
                },
            }),
            getSettings: async () => ({ notifications: { governancePolls: true } }),
            notify: vi.fn(),
            loadSeen: async () => ({ 'bitcoin-regtest': ['3'] }),
            saveSeen,
            intervalMs: 1e9,
        });
        await watcher.pollOnce();
        saveSeen.mockClear();
        // Poll 3 closed and poll 7 opened: the tick prunes, so it has a change to save.
        polls = [{ action_index: 7, tick: 'GOV' }];
        pending.hold = true;
        await stopMidPoll(watcher, pending);
        expect(saveSeen).not.toHaveBeenCalled();
    });

    it('dispenser escrow does not save after stop during a delivery', async () => {
        const pending = { gate: gate(), reached: false };
        const saveSeen = vi.fn();
        const notify = vi.fn(async () => {
            pending.reached = true;
            await pending.gate.promise;
            return true;
        });
        const rows = ['1', '2'].map((index) => ({
            action_index: index, status: 'valid', give_amount: '10', give_tick: 'XCHAIN',
        }));
        const watcher = new DispenserEscrowWatcher({
            getActiveAddresses: ADDRESSES,
            getSdkForChain: () => ({
                getDispensers: async () => ({ data: rows }),
                getAction: async () => ({ state: { give_remaining: '25', status: 'open' } }),
            }),
            getSettings: async () => ({ notifications: {} }),
            notify,
            saveSeen,
            intervalMs: 1e9,
        });
        await stopMidPoll(watcher, pending);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(saveSeen).not.toHaveBeenCalled();
    });
});
