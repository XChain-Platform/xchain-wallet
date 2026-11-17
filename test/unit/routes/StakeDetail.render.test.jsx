// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

// An action row's accessible name is its title, then its description or reason.
const row = (title) => ({ name: new RegExp(`^${title}\\b`) });

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qstakerstakerstakerstakerstakerxxx';

afterEach(cleanup);

function mount(props = {}, overrides = {}) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue([
            { action_index: 1, amount: '25', asset: 'XCHAIN', status: 'active', block_index: 90 },
        ]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([
            { action_index: 2, amount: '3', status: 'valid', block_index: 95 },
        ]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakeDetail
                walletId="wallet-1"
                kind="validator"
                chainId={CHAIN}
                address={ADDRESS}
                onBack={vi.fn()}
                {...props}
            />
        </MessagingProvider>,
    );
    return messaging;
}

describe('StakeDetail rendering', () => {
    it('shows the staked amount in the hero and enables the validator tiles', async () => {
        const onClaimRewards = vi.fn();
        const onUnstake = vi.fn();
        const onDelegate = vi.fn();
        mount({ onClaimRewards, onUnstake, onDelegate });

        expect(await screen.findByRole('heading', { name: 'Validator Stake' })).toBeInTheDocument();
        expect(screen.getByLabelText('25 XCHAIN staked')).toBeInTheDocument();
        expect(screen.getByText('XCHAIN staked')).toBeInTheDocument();

        const tiles = screen.getByRole('list', { name: 'Stake actions' });
        for (const [name, handler] of [
            ['Claim', onClaimRewards],
            ['Unstake', onUnstake],
            ['Delegate', onDelegate],
        ]) {
            const button = within(tiles).getByRole('button', row(name));
            expect(button).not.toHaveAttribute('aria-disabled');
            fireEvent.click(button);
            expect(handler).toHaveBeenCalledOnce();
        }
    });

    it('opens on the Actions tab, with Rewards and Details beside it and no Delegation tab', async () => {
        mount({ onClaimRewards: vi.fn() });

        const actions = await screen.findByRole('tab', { name: 'Actions' });
        expect(actions).toHaveAttribute('aria-selected', 'true');
        expect(screen.getAllByRole('tab', { name: /^(Actions|Rewards|Details)$/ })).toHaveLength(3);
        expect(screen.queryByRole('tab', { name: 'Delegation' })).toBeNull();
        expect(screen.getByRole('list', { name: 'Stake actions' })).toBeInTheDocument();

        // Every action lives in the Actions tab: no Claim button anywhere else.
        expect(screen.getAllByRole('button', row('Claim'))).toHaveLength(1);
        fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }));
        expect(screen.queryByRole('list', { name: 'Stake actions' })).toBeNull();
        expect(screen.queryByRole('button', row('Claim'))).toBeNull();
        expect(screen.getByRole('list', { name: 'Reward events' })).toBeInTheDocument();
    });

    it('offers Withdraw and Stake Again once the stake has ended', async () => {
        const onWithdraw = vi.fn();
        mount({ onWithdraw }, {
            getStakesForAddress: vi.fn().mockResolvedValue([
                { action_index: 1, amount: '25', asset: 'XCHAIN', status: 'valid', block_index: 40, deactivation_block: 60 },
            ]),
        });

        const tiles = await screen.findByRole('list', { name: 'Stake actions' });
        const withdraw = within(tiles).getByRole('button', row('Withdraw'));
        expect(withdraw).not.toHaveAttribute('aria-disabled');
        fireEvent.click(withdraw);
        expect(onWithdraw).toHaveBeenCalledOnce();
        // Stake Again falls back to the add-stake handler.
        expect(within(tiles).getByRole('button', row('Stake again'))).toHaveAttribute('aria-disabled', 'true');
        expect(within(tiles).getByRole('button', row('Unstake'))).toHaveAttribute('aria-disabled', 'true');
    });

    it('calls the add-stake handler from Add Stake and from Stake Again, and hides Withdraw when none is wired', async () => {
        const onStakeMore = vi.fn();
        mount({ onStakeMore }, {
            getStakesForAddress: vi.fn().mockResolvedValue([
                { action_index: 1, amount: '25', asset: 'XCHAIN', status: 'valid', block_index: 40, deactivation_block: 60 },
            ]),
        });
        const tiles = await screen.findByRole('list', { name: 'Stake actions' });
        expect(within(tiles).queryByRole('button', row('Withdraw'))).toBeNull();
        const again = within(tiles).getByRole('button', row('Stake again'));
        expect(again).not.toHaveAttribute('aria-disabled');
        fireEvent.click(again);
        expect(onStakeMore).toHaveBeenCalledOnce();
    });

    it('enables Add Stake on an active stake and calls its handler', async () => {
        const onStakeMore = vi.fn();
        mount({ onStakeMore });
        const tiles = await screen.findByRole('list', { name: 'Stake actions' });
        const add = within(tiles).getByRole('button', row('Add stake'));
        expect(add).not.toHaveAttribute('aria-disabled');
        fireEvent.click(add);
        expect(onStakeMore).toHaveBeenCalledOnce();
    });

    it('draws the actions as the shared action list under Actions, the first and chosen tab (G101, G102)', async () => {
        const onRevokeDelegation = vi.fn();
        mount({ onClaimRewards: vi.fn(), onUnstake: vi.fn(), onDelegate: vi.fn(), onStakeMore: vi.fn(), onRevokeDelegation });

        const tabs = within(await screen.findByRole('tablist', { name: 'Stake detail view' })).getAllByRole('tab');
        expect(tabs[0]).toHaveAccessibleName('Actions');
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

        const list = screen.getByRole('list', { name: 'Stake actions' });
        expect(list.tagName).toBe('UL');
        const rows = within(list).getAllByRole('listitem');
        expect(rows.map((item) => item.querySelector('[data-action-id]')?.getAttribute('data-action-id')))
            .toEqual(['add-stake', 'unstake', 'claim', 'delegate', 'revoke']);
        // Each row carries its one-line description and the default tone; the
        // stake has no destructive action.
        const claim = within(list).getByRole('button', row('Claim'));
        expect(claim).toHaveTextContent('Collect the rewards this stake has earned');
        for (const item of rows) {
            expect(item.querySelector('[data-action-id]')).toHaveAttribute('data-tone', 'default');
        }
        // A locked row stays reachable and says why in place of its description.
        const revoke = within(list).getByRole('button', row('Revoke'));
        expect(revoke).toHaveAttribute('aria-disabled', 'true');
        expect(revoke).toHaveAccessibleDescription('No delegated key to revoke.');
        fireEvent.click(revoke);
        expect(onRevokeDelegation).not.toHaveBeenCalled();
    });
});
