// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-45: the deadline watcher.
//
// The properties worth pinning are the two that are easy to get wrong and
// invisible when wrong: an EXPIRATION is a UNIX TIMESTAMP judged against the
// CHAIN's block time (not the local clock, and not a block count), while a
// poll's END_BLOCK is a block HEIGHT judged against the chain tip. Mixing the
// two silently produces deadlines that are wrong by orders of magnitude.

import { describe, it, expect, vi } from 'vitest';
import { DeadlineWatcher, describeWindow } from '../../../packages/core/src/notifications/DeadlineWatcher.js';

const NOW = 1785117541;          // a chain tip block time
const HEIGHT = 5000;             // and its height
const HOUR = 3600;
const DAY = 86400;

function makeSdk({ orders = [], swaps = [], dispensers = [], polls = [], votes = [], status } = {}) {
    return {
        explorer: { coin: 'RBTC' },
        getStatus: async () => (status !== undefined ? status : {
            last_block_time: { RBTC: NOW },
            chain_tip: { RBTC: HEIGHT },
        }),
        getOrders: async () => ({ data: orders }),
        getSwaps: async () => ({ data: swaps }),
        getDispensers: async () => ({ data: dispensers }),
        getPolls: async () => ({ data: polls }),
        getVotes: async () => ({ data: votes }),
    };
}

function makeWatcher(sdk, overrides = {}) {
    const notify = vi.fn();
    const watcher = new DeadlineWatcher({
        getActiveAddresses: async () => [{ chainId: 'bitcoin-regtest', address: 'bcrt1qmine', label: 'BTC regtest' }],
        getSdkForChain: () => sdk,
        getSettings: async () => ({ notifications: {} }),
        coinForChain: () => 'bitcoin',
        notify,
        ...overrides,
    });
    return { watcher, notify };
}

const openOrder = (over = {}) => ({
    action_index: '100', status: 'valid', order_status: 'open', expiration: NOW + HOUR, ...over,
});

describe('DeadlineWatcher', () => {
    it('announces an order whose timestamp expiry falls inside the window', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({ orders: [openOrder()] }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n.kind).toBe('deadline');
        expect(n.body).toContain('order #100');
        expect(n.body).toContain('1 hour');
        expect(n.data).toMatchObject({ kind: 'order', actionIndex: '100', route: 'my-orders' });
    });

    it('does not baseline: a deadline already near at startup announces on the first tick', async () => {
        // GovernancePollWatcher silences its first tick; here that would
        // suppress the most urgent case the feature exists for.
        const { notify } = makeWatcher(makeSdk({ orders: [openOrder({ expiration: NOW + 60 })] }));
        expect(notify).not.toHaveBeenCalled();
        const { watcher, notify: n2 } = makeWatcher(makeSdk({ orders: [openOrder({ expiration: NOW + 60 })] }));
        await watcher.pollOnce();
        expect(n2).toHaveBeenCalledTimes(1);
    });

    it('ignores deadlines beyond the window and ones already past', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({
            orders: [
                openOrder({ action_index: '1', expiration: NOW + 5 * DAY }),
                openOrder({ action_index: '2', expiration: NOW - HOUR }),
            ],
        }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('treats a zero or absent expiration as "never expires", not as long past', async () => {
        // Number(0) is finite and less than any block time, so a naive check
        // would report every non-expiring order as overdue.
        const { watcher, notify } = makeWatcher(makeSdk({
            orders: [openOrder({ action_index: '1', expiration: 0 }), openOrder({ action_index: '2', expiration: null })],
        }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('judges expiry against the chain block time, not the local clock', async () => {
        // Chain tip lags real time by a day. An order expiring 1h after the
        // chain's clock is NOT yet due by the local clock's reckoning, and the
        // indexer settles on the chain's.
        const laggingSdk = makeSdk({
            orders: [openOrder({ expiration: NOW + HOUR })],
            status: { last_block_time: { RBTC: NOW - 5 * DAY }, chain_tip: { RBTC: HEIGHT } },
        });
        const { watcher, notify } = makeWatcher(laggingSdk);
        await watcher.pollOnce();
        // 5 days + 1h out on the chain's clock: outside the 24h window.
        expect(notify).not.toHaveBeenCalled();
    });

    it('skips timestamp lanes entirely when the chain has no usable block time', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({
            orders: [openOrder()],
            status: { chain_tip: { RBTC: HEIGHT } },
        }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('announces a poll by BLOCK distance, converted from the window at the coin interval', async () => {
        // bitcoin: 600s blocks, so a 24h window is ~144 blocks.
        const { watcher, notify } = makeWatcher(makeSdk({
            polls: [{ action_index: '2841', source: 'bcrt1qmine', end_block: HEIGHT + 10, tick: 'XCHAIN' }],
        }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n.body).toContain('10 blocks');
        expect(n.body).toContain('you created');
        expect(n.data).toMatchObject({ kind: 'poll', endBlock: HEIGHT + 10, route: 'poll-detail' });
    });

    it('does not treat a poll close as if END_BLOCK were a timestamp', async () => {
        // A block height read as a Unix timestamp is ~1970: instantly "past".
        // Read correctly, this poll is 200 blocks out = beyond the ~144 window.
        const { watcher, notify } = makeWatcher(makeSdk({
            polls: [{ action_index: '9', source: 'bcrt1qmine', end_block: HEIGHT + 200 }],
        }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('covers polls the user voted in, not only ones they created', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({
            polls: [{ action_index: '55', source: 'bcrt1qsomeoneelse', end_block: HEIGHT + 5, tick: 'GOV' }],
            votes: [{ poll_action_index: '55' }],
        }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].body).toContain('you voted in');
    });

    it('ignores other people\'s polls', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({
            polls: [{ action_index: '55', source: 'bcrt1qsomeoneelse', end_block: HEIGHT + 5 }],
        }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('skips items that are no longer open', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({
            orders: [
                openOrder({ action_index: '1', order_status: 'cancelled' }),
                openOrder({ action_index: '2', status: 'invalid' }),
            ],
        }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('announces once, then stays quiet on later ticks', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({ orders: [openOrder()] }));
        await watcher.pollOnce();
        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('lets a deadline announce again once it has left and re-entered the set', async () => {
        const sdk = makeSdk({ orders: [openOrder()] });
        const { watcher, notify } = makeWatcher(sdk);
        await watcher.pollOnce();
        sdk.getOrders = async () => ({ data: [] });   // cancelled
        await watcher.pollOnce();
        sdk.getOrders = async () => ({ data: [openOrder()] }); // re-listed
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('collapses a burst into one summary, led by the soonest deadline', async () => {
        const orders = Array.from({ length: 8 }, (_v, i) => openOrder({
            action_index: String(i + 1),
            expiration: NOW + (i + 2) * HOUR,
        }));
        orders.push(openOrder({ action_index: '99', expiration: NOW + 60 })); // the urgent one
        const { watcher, notify } = makeWatcher(makeSdk({ orders }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n.kind).toBe('deadline-summary');
        expect(n.title).toContain('9 deadlines');
        expect(n.body).toContain('1 minute');
    });

    it('makes no network call while the feature is switched off', async () => {
        const sdk = makeSdk({ orders: [openOrder()] });
        const spy = vi.spyOn(sdk, 'getStatus');
        const { watcher, notify } = makeWatcher(sdk, {
            getSettings: async () => ({ notifications: { deadlines: false } }),
        });
        await watcher.pollOnce();
        expect(spy).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('defaults ON for a settings record that predates the flag', async () => {
        const { watcher, notify } = makeWatcher(makeSdk({ orders: [openOrder()] }), {
            getSettings: async () => ({ notifications: { governancePolls: true } }),
        });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('survives a lane that throws and still reports the others', async () => {
        const sdk = makeSdk({ orders: [openOrder()] });
        sdk.getSwaps = async () => { throw new Error('explorer down'); };
        sdk.getDispensers = async () => { throw new Error('explorer down'); };
        const { watcher, notify } = makeWatcher(sdk);
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('requires its dependencies', () => {
        expect(() => new DeadlineWatcher({})).toThrow(/getActiveAddresses/);
    });
});

describe('describeWindow', () => {
    it('reads as plain language at each scale', () => {
        expect(describeWindow(45)).toBe('45 seconds');
        expect(describeWindow(60)).toBe('1 minute');
        expect(describeWindow(3600)).toBe('1 hour');
        expect(describeWindow(7200)).toBe('2 hours');
        expect(describeWindow(86400)).toBe('1 day');
        expect(describeWindow(3 * 86400)).toBe('3 days');
    });
});
