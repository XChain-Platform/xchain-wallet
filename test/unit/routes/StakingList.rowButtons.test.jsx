// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingList, stakeRowLabel } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN = 'bitcoin-mainnet';
const ONE = 'bc1qoneoneoneoneoneoneoneoneoneoneoneone';
const TWO = 'bc1qtwotwotwotwotwotwotwotwotwotwotwotwo';

afterEach(cleanup);

function renderList(onOpenStake = vi.fn()) {
    const read = (map) => vi.fn(async ({ address }) => map[address] || []);
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: ONE }, { id: 'a2', address: TWO }],
        }),
        getStakesForAddress: read({
            [ONE]: [{ stake_id: 's1', amount: '10', status: 'active', block_index: 9 }],
            [TWO]: [{ stake_id: 's2', amount: '20', status: 'active', block_index: 8 }],
        }),
        getDelegationsForAddress: read({}),
        getRewardsForAddress: read({}),
        getRewardClaimsForAddress: read({}),
        getContractStakesForAddress: read({}),
        getContractUnstakesForAddress: read({}),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakingList walletId="wallet-1" onOpenStake={onOpenStake} onBack={vi.fn()} />
        </MessagingProvider>,
    );
    return onOpenStake;
}

describe('StakingList stake rows', () => {
    it('exposes each position as a real button inside its own list item', async () => {
        renderList();
        await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
        for (const item of screen.getAllByRole('listitem')) {
            const buttons = within(item).getAllByRole('button');
            expect(buttons).toHaveLength(1);
            expect(buttons[0].tagName).toBe('BUTTON');
            expect(buttons[0].querySelector('button, a, input, [role="button"]')).toBeNull();
        }
    });

    it('gives two validator stakes distinct names that name the position', async () => {
        renderList();
        const rows = await screen.findAllByRole('button', { name: /^Open Validator stake/ });
        expect(rows).toHaveLength(2);
        const names = rows.map((row) => row.getAttribute('aria-label'));
        expect(new Set(names).size).toBe(2);
        expect(names.some((name) => name.includes('10 XCHAIN'))).toBe(true);
        expect(names.some((name) => name.includes('20 XCHAIN'))).toBe(true);
        expect(names.some((name) => name.endsWith('bc1qon…eone'))).toBe(true);
        expect(names.some((name) => name.endsWith('bc1qtw…otwo'))).toBe(true);
    });

    it('joins the position, amount and owner and drops empty parts', () => {
        expect(stakeRowLabel({ name: 'Validator stake', subtitle: '10 XCHAIN', subtitle2: 'bc1qon…eone' }))
            .toBe('Open Validator stake, 10 XCHAIN, bc1qon…eone');
        expect(stakeRowLabel({ name: 'Contract stake', subtitle: '5 XCHAIN', subtitle2: null }))
            .toBe('Open Contract stake, 5 XCHAIN');
    });

    it('activates a focused row with Enter and with Space', async () => {
        const onOpenStake = renderList();
        const user = userEvent.setup();
        const first = await screen.findByRole('button', { name: /^Open Validator stake, 10 XCHAIN/ });
        first.focus();
        await user.keyboard('{Enter}');
        expect(onOpenStake).toHaveBeenLastCalledWith(expect.objectContaining({ address: ONE }));
        const second = screen.getByRole('button', { name: /^Open Validator stake, 20 XCHAIN/ });
        second.focus();
        await user.keyboard('{Space}');
        expect(onOpenStake).toHaveBeenCalledTimes(2);
        expect(onOpenStake).toHaveBeenLastCalledWith(expect.objectContaining({ address: TWO }));
    });

    it('opens the position the named button belongs to', async () => {
        const onOpenStake = renderList();
        const row = await screen.findByRole('button', { name: /^Open Validator stake, 20 XCHAIN/ });
        fireEvent.click(row);
        expect(onOpenStake).toHaveBeenCalledWith(expect.objectContaining({ kind: 'validator', address: TWO }));
    });
});
