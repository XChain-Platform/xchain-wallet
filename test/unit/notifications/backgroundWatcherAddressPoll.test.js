// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';
import { DeadlineWatcher } from '../../../packages/core/src/notifications/DeadlineWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';

const WATCHERS = [
    ['governance', GovernancePollWatcher],
    ['deadline', DeadlineWatcher],
    ['dispenser escrow', DispenserEscrowWatcher],
];

function makeWatcher(Watcher, getActiveAddresses, overrides = {}) {
    const logger = {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const getSdkForChain = vi.fn(() => ({}));
    const watcher = new Watcher({
        getActiveAddresses,
        getSdkForChain,
        getSettings: vi.fn(async () => ({ notifications: {} })),
        notify: vi.fn(),
        intervalMs: 1_000,
        logger,
        ...overrides,
    });
    return { watcher, logger, getSdkForChain };
}

function lockedError() {
    const error = new Error('Vault is not open');
    error.name = 'VaultStateError';
    return error;
}

afterEach(() => {
    vi.useRealTimers();
});

describe.each(WATCHERS)('%s watcher address polling', (_name, Watcher) => {
    it('quietly skips locked and empty wallets without reaching an SDK', async () => {
        const loadSeen = vi.fn();
        const getActiveAddresses = vi.fn()
            .mockRejectedValueOnce(lockedError())
            .mockRejectedValueOnce(new Error('VaultStateError: vault is closed'))
            .mockResolvedValueOnce([]);
        const { watcher, logger, getSdkForChain } = makeWatcher(Watcher, getActiveAddresses, { loadSeen });

        await watcher.pollOnce();
        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(getActiveAddresses).toHaveBeenCalledTimes(3);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(loadSeen).not.toHaveBeenCalled();
        expect(getSdkForChain).not.toHaveBeenCalled();
    });

    it('quietly skips when settings detect that the wallet is locked', async () => {
        const getActiveAddresses = vi.fn();
        const { watcher, logger, getSdkForChain } = makeWatcher(Watcher, getActiveAddresses, {
            getSettings: vi.fn(async () => { throw lockedError(); }),
        });

        await watcher.pollOnce();

        expect(getActiveAddresses).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(getSdkForChain).not.toHaveBeenCalled();
    });

    it('backs off repeated failures and logs once until an address read recovers', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const getActiveAddresses = vi.fn()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockRejectedValueOnce(new Error('still failing'))
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('new failure streak'));
        const { watcher, logger, getSdkForChain } = makeWatcher(Watcher, getActiveAddresses);

        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1_000);
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1_000);
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(1_000);
        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(getActiveAddresses).toHaveBeenCalledTimes(4);
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error.mock.calls[0][0]).toContain('getActiveAddresses failed');
        expect(getSdkForChain).not.toHaveBeenCalled();
    });
});

describe('background watcher seen caps', () => {
    it('does not repeatedly announce governance polls that cannot be remembered', async () => {
        const polls = Array.from({ length: 501 }, (_, index) => ({
            action_index: String(index),
            tick: 'GOV',
        }));
        const notify = vi.fn();
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: vi.fn(),
            getSdkForChain: () => ({
                getPolls: vi.fn(async () => polls),
                getBalances: vi.fn(async () => [{ tick: 'GOV', quantity: '1' }]),
            }),
            getSettings: vi.fn(),
            notify,
        });
        watcher._seen.set('chain', new Set(polls.slice(0, 500).map((poll) => poll.action_index)));

        await watcher._tickChain('chain', 'Chain', ['address']);
        await watcher._tickChain('chain', 'Chain', ['address']);

        expect(notify).not.toHaveBeenCalled();
    });

    it('does not repeatedly announce deadlines that cannot be remembered', async () => {
        const blockTime = 1_800_000_000;
        const orders = Array.from({ length: 501 }, (_, index) => ({
            action_index: String(index),
            status: 'valid',
            order_status: 'open',
            expiration: blockTime + 60,
        }));
        const notify = vi.fn();
        const watcher = new DeadlineWatcher({
            getActiveAddresses: vi.fn(),
            getSdkForChain: () => ({
                explorer: { coin: 'BTC' },
                getStatus: vi.fn(async () => ({
                    last_block_time: { BTC: blockTime },
                    chain_tip: { BTC: 1 },
                })),
                getOrders: vi.fn(async () => orders),
                getSwaps: vi.fn(async () => []),
                getDispensers: vi.fn(async () => []),
                getPolls: vi.fn(async () => []),
                getVotes: vi.fn(async () => []),
            }),
            getSettings: vi.fn(),
            coinForChain: () => 'bitcoin',
            notify,
        });
        watcher._seen.set('chain', new Set(orders.slice(0, 500).map((order) => `order:${order.action_index}`)));

        await watcher._tickChain('chain', 'Chain', ['address']);
        await watcher._tickChain('chain', 'Chain', ['address']);

        expect(notify).not.toHaveBeenCalled();
    });
});
