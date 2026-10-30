// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the demo staking fixtures resolve on every Bitcoin network the demo
// wallet can view. The demo lands on mainnet, so a fixture keyed only by
// bitcoin-regtest left Staking reading "Nothing staked yet" while the rest
// of the demo told a staking story.

import { describe, expect, it } from 'vitest';
import {
    synthesizeDemoContractMeta,
    synthesizeDemoContractStakes,
    synthesizeDemoStaking,
} from '../../../packages/core/src/flows/demoFixtures.js';

const BITCOIN_NETWORKS = ['bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest'];

describe('demo staking fixtures', () => {
    for (const chainId of BITCOIN_NETWORKS) {
        it(`populate the validator stake on ${chainId}`, () => {
            const { stakes, delegations, rewards } = synthesizeDemoStaking(chainId);
            expect(stakes.map((s) => [s.stake_id, s.amount])).toEqual([['demo-stake-validator', '50000']]);
            expect(delegations).toHaveLength(1);
            expect(rewards.length).toBeGreaterThan(0);
        });

        it(`populate the contract stakes and their deploy metadata on ${chainId}`, () => {
            const { stakes, unstakes, slashEvents } = synthesizeDemoContractStakes(chainId);
            expect(stakes.map((s) => s.target_contract_index)).toEqual(['1024', '2048']);
            expect(unstakes).toHaveLength(1);
            expect(slashEvents).toHaveLength(1);
            expect(synthesizeDemoContractMeta(chainId, 1024)).toMatchObject({ cooldown_blocks: 144 });
            expect(synthesizeDemoContractMeta(chainId, '2048')).toMatchObject({ cooldown_blocks: 240 });
        });
    }

    it('show a mainnet slash destination, since the demo lands on mainnet', () => {
        expect(synthesizeDemoContractMeta('bitcoin-mainnet', 2048).slash_destination).toMatch(/^bc1q/);
        expect(synthesizeDemoContractStakes('bitcoin-mainnet').slashEvents[0].destination_address)
            .toMatch(/^bc1q/);
    });

    it('stay empty on chains without staking', () => {
        for (const chainId of ['litecoin-mainnet', 'dogecoin-regtest', 'unknown-chain']) {
            expect(synthesizeDemoStaking(chainId)).toEqual({ stakes: [], delegations: [], rewards: [] });
            expect(synthesizeDemoContractStakes(chainId)).toEqual({ stakes: [], unstakes: [], slashEvents: [] });
            expect(synthesizeDemoContractMeta(chainId, 1024)).toBeNull();
        }
    });

    it('return fresh copies so callers cannot mutate the fixture', () => {
        synthesizeDemoStaking('bitcoin-mainnet').stakes[0].amount = '1';
        expect(synthesizeDemoStaking('bitcoin-regtest').stakes[0].amount).toBe('50000');
    });
});
