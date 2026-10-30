// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Explorer rows whose fields are objects or arrays instead of text and
// numbers must leave the staking screens standing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';
import { scalarRows } from '../../../packages/core/src/flows/stakingDashboard.js';

afterEach(cleanup);

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const O = { a: 1 };

function messagingWith(extra = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a', address: ADDRESS }] }),
        getStakesForAddress: vi.fn().mockResolvedValue([{
            action_index: O, stake_id: O, amount: O, asset: O, capability_label: O,
            signing_pubkey: O, status: O, block_index: O, activation_block: O,
        }, { action_index: 2, amount: '5', asset: 5 }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([{ signing_pubkey: O, block_index: O, delegation_id: O, status: O }]),
        getRewardsForAddress: vi.fn().mockResolvedValue([{ id: O, amount: O, reward_type: O, block_index: O, status: O }]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([{ action_index: O, amount: O, status: O }]),
        getContractStakesForAddress: vi.fn().mockResolvedValue([
            { target_contract_index: 7, tick: O, amount: O, signing_pubkey: O, action_index: O, status: O, block_index: O },
            { target_contract_index: O, tick: 5, amount: [], signing_pubkey: 5 },
        ]),
        getContractUnstakesForAddress: vi.fn().mockResolvedValue([
            { target_contract_index: 7, tick: O, amount: O, cooldown_end_block: O, status: 'valid', action_index: O },
        ]),
        getSlashEventsForAddress: vi.fn().mockResolvedValue([
            { target_contract_index: 7, amount: O, tick: O, destination: O, block_index: O },
        ]),
        getContractByActionIndex: vi.fn().mockResolvedValue({ cooldown_blocks: O, slash_destination: O, tick: O }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getBroadcastsForAddress: vi.fn().mockResolvedValue([{ message: O, value: O, block_index: O, action_format: O }]),
        getValidatorsForChain: vi.fn().mockResolvedValue([{ signing_pubkey: O, uptime: O, score: O }]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        ...extra,
    };
    return new Proxy(target, {
        get: (object, property) => (property in object ? object[property] : vi.fn().mockResolvedValue(null)),
    });
}

const mount = (ui) => render(<MessagingProvider shell="web" messaging={messagingWith()}>{ui}</MessagingProvider>);

describe('scalarRows', () => {
    it('keeps text, numbers and null, and drops object and array fields and non-row entries', () => {
        expect(scalarRows([{ a: 'x', b: 2, c: null, d: { e: 1 }, f: [1] }, 7, null, ['x']]))
            .toEqual([{ a: 'x', b: 2, c: null }]);
    });
});

describe('staking screens given rows with object fields', () => {
    it('keeps the staking list standing', async () => {
        mount(<StakingList walletId="w" onOpenStake={() => {}} onBack={() => {}} />);

        expect(await screen.findByRole('heading', { name: 'Staking' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    });

    it('keeps the validator detail standing', async () => {
        mount(<StakeDetail walletId="w" kind="validator" chainId={CHAIN} address={ADDRESS} onBack={() => {}} />);

        expect(await screen.findByRole('heading', { name: 'Validator stake' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Pending rewards')).toBeInTheDocument());
    });

    it('keeps the contract detail standing on every tab', async () => {
        mount(<StakeDetail walletId="w" kind="contract" contractActionIndex="7" chainId={CHAIN} address={ADDRESS} onBack={() => {}} />);

        expect(await screen.findByRole('heading', { name: 'Contract #7 stake' })).toBeInTheDocument();
        for (const name of ['Penalties', 'Details', 'Positions']) {
            fireEvent.click(screen.getByRole('tab', { name }));
            expect(screen.getByRole('heading', { name: 'Contract #7 stake' })).toBeInTheDocument();
        }
    });

    it('keeps the operator dashboard standing', async () => {
        mount(<OperatorDashboard walletId="w" chainId={CHAIN} address={ADDRESS} onBack={() => {}} />);

        expect(await screen.findByRole('heading', { name: 'Operator dashboard' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Staking status')).toBeInTheDocument());
    });
});
