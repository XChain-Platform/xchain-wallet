// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { DeadlineWatcher } from '../../../packages/core/src/notifications/DeadlineWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';
import { PriceAlertWatcher } from '../../../packages/core/src/notifications/PriceAlertWatcher.js';

const address = {
    address: 'bcrt1qmine',
    chainId: 'bitcoin-regtest',
    label: 'Bitcoin regtest',
    network: 'regtest',
};

describe('notification delivery recovery', () => {
    it('retries a failed price-alert state write without delivering twice', async () => {
        const notify = vi.fn(async () => true);
        const markTriggered = vi.fn()
            .mockRejectedValueOnce(new Error('vault write failed'))
            .mockResolvedValueOnce(undefined);
        const watcher = new PriceAlertWatcher({
            getNativePrices: vi.fn(async () => ({
                prices: { 'bitcoin-mainnet': { priceFiat: 71000 } },
            })),
            listArmedAlerts: vi.fn(async () => [{
                id: 'alert-1',
                chainId: 'bitcoin-mainnet',
                direction: 'above',
                targetFiat: 70000,
                fiatCurrency: 'usd',
                status: 'armed',
            }]),
            getSettings: vi.fn(async () => ({
                privacy: { priceDataEnabled: true },
                notifications: { priceAlerts: true },
            })),
            notify,
            markTriggered,
        });

        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(notify).toHaveBeenCalledTimes(1);
        expect(markTriggered).toHaveBeenCalledTimes(2);
    });

    it('retries a governance notification after balance and delivery failures', async () => {
        const polls = [];
        const getBalances = vi.fn()
            .mockRejectedValueOnce(new Error('balance read failed'))
            .mockResolvedValue([{ tick: 'GOV', quantity: '1' }])
            .mockResolvedValue([{ tick: 'GOV', quantity: '1' }]);
        const notify = vi.fn()
            .mockRejectedValueOnce(new Error('delivery failed'))
            .mockResolvedValueOnce(true);
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: vi.fn(async () => [address]),
            getSdkForChain: vi.fn(() => ({
                getPolls: vi.fn(async () => polls),
                getBalances,
            })),
            getSettings: vi.fn(async () => ({ notifications: { governancePolls: true } })),
            notify,
        });

        await watcher.pollOnce();
        polls.push({ action_index: 7, tick: 'GOV' });
        await watcher.pollOnce();
        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(getBalances).toHaveBeenCalledTimes(3);
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('retries a dispenser alert when the adapter refuses delivery', async () => {
        const notify = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const watcher = new DispenserEscrowWatcher({
            getActiveAddresses: vi.fn(async () => [address]),
            getSdkForChain: vi.fn(() => ({
                getDispensers: vi.fn(async () => ({
                    data: [{
                        action_index: '9',
                        status: 'valid',
                        give_amount: '10',
                        give_tick: 'TOKEN',
                    }],
                })),
                getAction: vi.fn(async () => ({
                    state: { status: 'open', give_remaining: '20' },
                })),
            })),
            getSettings: vi.fn(async () => ({ notifications: { dispenserEscrow: true } })),
            notify,
        });

        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('retries a deadline alert after delivery throws', async () => {
        const notify = vi.fn()
            .mockRejectedValueOnce(new Error('delivery failed'))
            .mockResolvedValueOnce(true);
        const watcher = new DeadlineWatcher({
            getActiveAddresses: vi.fn(async () => [address]),
            getSdkForChain: vi.fn(() => ({
                explorer: { coin: 'RBTC' },
                getStatus: vi.fn(async () => ({
                    last_block_time: { RBTC: 1000 },
                    chain_tip: { RBTC: 100 },
                })),
                getOrders: vi.fn(async () => ({
                    data: [{
                        action_index: '11',
                        status: 'valid',
                        order_status: 'open',
                        expiration: 1100,
                    }],
                })),
                getSwaps: vi.fn(async () => ({ data: [] })),
                getDispensers: vi.fn(async () => ({ data: [] })),
                getPolls: vi.fn(async () => ({ data: [] })),
                getVotes: vi.fn(async () => ({ data: [] })),
            })),
            getSettings: vi.fn(async () => ({ notifications: { deadlines: true } })),
            notify,
        });

        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('retries a failed seen-state write on an unchanged poll', async () => {
        const saveSeen = vi.fn()
            .mockRejectedValueOnce(new Error('vault write failed'))
            .mockResolvedValueOnce(undefined);
        const watcher = new DeadlineWatcher({
            getActiveAddresses: vi.fn(async () => [address]),
            getSdkForChain: vi.fn(() => ({
                explorer: { coin: 'RBTC' },
                getStatus: vi.fn(async () => ({
                    last_block_time: { RBTC: 1000 },
                    chain_tip: { RBTC: 100 },
                })),
                getOrders: vi.fn(async () => ({
                    data: [{
                        action_index: '12',
                        status: 'valid',
                        order_status: 'open',
                        expiration: 1100,
                    }],
                })),
                getSwaps: vi.fn(async () => ({ data: [] })),
                getDispensers: vi.fn(async () => ({ data: [] })),
                getPolls: vi.fn(async () => ({ data: [] })),
                getVotes: vi.fn(async () => ({ data: [] })),
            })),
            getSettings: vi.fn(async () => ({ notifications: { deadlines: true } })),
            notify: vi.fn(async () => true),
            saveSeen,
        });

        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(saveSeen).toHaveBeenCalledTimes(2);
        expect(saveSeen.mock.calls[1][0]['bitcoin-regtest']).toContain('order:12');
    });
});
