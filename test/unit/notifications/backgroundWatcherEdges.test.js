// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { DeadlineWatcher } from '../../../packages/core/src/notifications/DeadlineWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';

function logger() {
    return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const activeAddress = {
    address: 'mine',
    chainId: 'bitcoin-mainnet',
    label: 'Bitcoin',
    network: 'mainnet',
};

describe.each([
    ['DeadlineWatcher', DeadlineWatcher],
    ['DispenserEscrowWatcher', DispenserEscrowWatcher],
    ['GovernancePollWatcher', GovernancePollWatcher],
])('%s settings failure', (name, Watcher) => {
    it('logs a non-lock settings error and skips address reads', async () => {
        const getActiveAddresses = vi.fn(async () => [activeAddress]);
        const log = logger();
        const watcher = new Watcher({
            getActiveAddresses,
            getSdkForChain: vi.fn(),
            getSettings: vi.fn(async () => { throw new Error('settings payload'); }),
            notify: vi.fn(),
            logger: log,
        });

        await expect(watcher.pollOnce()).resolves.toBeUndefined();
        expect(getActiveAddresses).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(
            expect.stringContaining(`${name}: getSettings failed`),
            '<Error>',
        );
        expect(JSON.stringify(log.error.mock.calls)).not.toContain('settings payload');
    });
});

describe('GovernancePollWatcher fallback payloads', () => {
    it('accepts token-shaped poll and balance responses', async () => {
        const polls = [];
        const sdk = {
            getPolls: vi.fn(async () => ({ tokens: polls })),
            getBalances: vi.fn(async () => ({ tokens: [{ tick: 'vote', amount: '1' }] })),
        };
        const notify = vi.fn(async () => true);
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: vi.fn(async () => [activeAddress]),
            getSdkForChain: vi.fn(() => sdk),
            getSettings: vi.fn(async () => ({})),
            notify,
        });

        await watcher.pollOnce();
        polls.push({ action_index: 7, tick: 'VOTE', end_block: 50 });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'governance-poll',
            data: expect.objectContaining({ pollIndex: 7, tick: 'VOTE' }),
        }));
    });

    it('marks a fresh poll seen when no balances API exists', async () => {
        const polls = [];
        const sdk = { getPolls: vi.fn(async () => polls) };
        const notify = vi.fn();
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: vi.fn(async () => [activeAddress]),
            getSdkForChain: vi.fn(() => sdk),
            getSettings: vi.fn(async () => ({})),
            notify,
        });

        await watcher.pollOnce();
        polls.push({ action_index: 8, tick: 'VOTE' });
        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
        expect(watcher._seen.get('bitcoin-mainnet')).toEqual(new Set(['8']));
    });
});

describe('DispenserEscrowWatcher limits and malformed detail', () => {
    it('checks only the lowest 25 action indexes and warns at the read cap', async () => {
        const rows = Array.from({ length: 26 }, (_, index) => ({
            action_index: String(26 - index),
            status: 'valid',
            give_amount: '10',
            give_tick: 'TOK',
        }));
        const sdk = {
            getDispensers: vi.fn(async () => ({ tokens: rows })),
            getAction: vi.fn(async () => ({ state: { status: 'open', give_remaining: '10' } })),
        };
        const log = logger();
        const notify = vi.fn(async () => true);
        const watcher = new DispenserEscrowWatcher({
            getActiveAddresses: vi.fn(),
            getSdkForChain: vi.fn(() => sdk),
            getSettings: vi.fn(),
            notify,
            logger: log,
        });

        await watcher._tickChain('bitcoin-mainnet', 'Bitcoin', ['mine']);
        expect(sdk.getAction).toHaveBeenCalledTimes(25);
        expect(sdk.getAction.mock.calls.map(([id]) => id)).toEqual(
            Array.from({ length: 25 }, (_, index) => String(index + 1)),
        );
        expect(notify).toHaveBeenCalledTimes(25);
        expect(log.warn.mock.calls[0][0]).toContain('26 open dispensers');
    });

    it('skips a remaining amount that cannot be divided', async () => {
        const sdk = {
            getDispensers: vi.fn(async () => [{
                action_index: '1', status: 'valid', give_amount: '2', give_tick: 'TOK',
            }]),
            getAction: vi.fn(async () => ({ state: { status: 'open', give_remaining: 'not-a-number' } })),
        };
        const notify = vi.fn();
        const watcher = new DispenserEscrowWatcher({
            getActiveAddresses: vi.fn(),
            getSdkForChain: vi.fn(() => sdk),
            getSettings: vi.fn(),
            notify,
        });

        await expect(watcher._tickChain('bitcoin-mainnet', 'Bitcoin', ['mine'])).resolves.toBe(false);
        expect(notify).not.toHaveBeenCalled();
    });
});

describe('DeadlineWatcher clock and poll fallbacks', () => {
    function makeWatcher(sdk, overrides = {}) {
        const notify = vi.fn(async () => true);
        const log = logger();
        const watcher = new DeadlineWatcher({
            getActiveAddresses: vi.fn(async () => [activeAddress]),
            getSdkForChain: vi.fn(() => sdk),
            getSettings: vi.fn(async () => ({})),
            notify,
            logger: log,
            ...overrides,
        });
        return { watcher, notify, log };
    }

    it('uses last_block when chain_tip is absent and accepts token-shaped polls', async () => {
        const sdk = {
            explorer: { coin: 'BTC' },
            getStatus: vi.fn(async () => ({ last_block: { BTC: 100 } })),
            getPolls: vi.fn(async () => ({ tokens: [{
                action_index: '9', source: 'mine', end_block: 101, tick: 'VOTE',
            }] })),
        };
        const { watcher, notify } = makeWatcher(sdk);

        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'deadline',
            data: expect.objectContaining({ kind: 'poll', endBlock: 101 }),
        }));
    });

    it('keeps creator-owned polls when vote lookup fails', async () => {
        const sdk = {
            explorer: { coin: 'BTC' },
            getStatus: vi.fn(async () => ({ chain_tip: { BTC: 100 } })),
            getPolls: vi.fn(async () => [{ action_index: '9', source: 'mine', end_block: 101 }]),
            getVotes: vi.fn(async () => { throw new Error('votes unavailable'); }),
        };
        const { watcher, notify, log } = makeWatcher(sdk);

        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(
            '[deadline] DeadlineWatcher: getVotes failed',
            '<Error>',
        );
    });

    it('returns null clocks when status reading throws', async () => {
        const sdk = {
            getStatus: vi.fn(async () => { throw new Error('status unavailable'); }),
            getOrders: vi.fn(),
            getPolls: vi.fn(),
        };
        const { watcher, notify, log } = makeWatcher(sdk);

        await watcher.pollOnce();
        expect(sdk.getOrders).not.toHaveBeenCalled();
        expect(sdk.getPolls).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
            '[deadline] DeadlineWatcher: getStatus failed',
            '<Error>',
        );
    });
});
