// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { loadDefiPositions } from '../../../packages/core/src/shared/hooks/useDefiPositions.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qdefipositionowner000000000000000000000';

function baseMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS }],
        }),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: [] }),
        getStakesForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getContractStakesForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getOrdersForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        ...overrides,
    };
}

function positionReadCount(messaging) {
    return [
        messaging.getDispensersForSource,
        messaging.getStakesForAddress,
        messaging.getContractStakesForAddress,
        messaging.getDepositsForAddress,
        messaging.getOrdersForAddress,
        messaging.getSwapsForAddress,
    ].reduce((total, read) => total + read.mock.calls.length, 0);
}

describe('Home DeFi loader', () => {
    it('maps a real wallet stake, dispenser, contract, order and swap', async () => {
        const messaging = baseMessaging({
            getDispensersForSource: vi.fn().mockResolvedValue({ data: [{
                action_index: '11', source: ADDRESS, status: 'open', current_status: 'open',
                give_tick: 'PEPE', give_amount: '5', escrow_remaining: '50', block_index: 101,
            }] }),
            getStakesForAddress: vi.fn().mockResolvedValue({ data: [{
                stake_id: 'stake-1', status: 'active', asset: 'XCHAIN', amount: '25', block_index: 102,
            }] }),
            getContractStakesForAddress: vi.fn().mockResolvedValue({ data: [{
                action_index: '13', target_contract_index: '7', tick: 'PEPE', amount: '10', block_index: 103,
            }] }),
            getOrdersForAddress: vi.fn().mockResolvedValue({ data: [{
                action_index: '14', source: ADDRESS, status: 'valid', give_tick: 'PEPE',
                give_amount: '4', block_index: 104, state: { status: 'open', give_remaining: '3' },
            }] }),
            getSwapsForAddress: vi.fn().mockResolvedValue({ data: [{
                action_index: '15', source: ADDRESS, status: 'valid', swap_status: 'open',
                give_tick: 'PEPE', give_amount: '2', block_index: 105,
            }] }),
        });

        const result = await loadDefiPositions({
            messaging,
            walletId: 'wallet-real',
            accountId: 'account-1',
            now: 1_760_000_000_000,
        });

        expect(result.failed).toBe(false);
        expect(result.positions.map((position) => position.kind).sort())
            .toEqual(['contract', 'dispenser', 'order', 'stake', 'swap']);
        expect(result.positions.map((position) => position.action).sort())
            .toEqual(['DISPENSER', 'ORDER', 'STAKE', 'STAKE', 'SWAP']);
        expect(positionReadCount(messaging)).toBe(6);
    });

    it('keeps the per-address read count fixed when one response grows from 1 row to 20', async () => {
        const order = (index) => ({
            action_index: String(index + 1),
            source: ADDRESS,
            status: 'valid',
            give_tick: 'PEPE',
            give_amount: '1',
            block_index: index + 1,
            state: { status: 'open', give_remaining: '1' },
        });
        const one = baseMessaging({
            getOrdersForAddress: vi.fn().mockResolvedValue({ data: [order(0)] }),
        });
        const twenty = baseMessaging({
            getOrdersForAddress: vi.fn().mockResolvedValue({
                data: Array.from({ length: 20 }, (_, index) => order(index)),
            }),
        });

        const oneResult = await loadDefiPositions({ messaging: one, walletId: 'wallet-one' });
        const twentyResult = await loadDefiPositions({ messaging: twenty, walletId: 'wallet-twenty' });

        expect(oneResult.positions).toHaveLength(1);
        expect(twentyResult.positions).toHaveLength(20);
        expect(positionReadCount(one)).toBe(6);
        expect(positionReadCount(twenty)).toBe(6);
        expect(one.getAddressesByChain).toHaveBeenCalledTimes(1);
        expect(twenty.getAddressesByChain).toHaveBeenCalledTimes(1);
    });
});

