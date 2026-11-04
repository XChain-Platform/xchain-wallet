// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A stake row is a shared Button: its native button carries the kit's base
// class with one variant and one size, so the row takes the kit's focus,
// press and forced-colours behaviour, while the screen stylesheet keeps the
// row's own layout and look.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import local from '../../../packages/core/src/shared/routes/StakingList.module.css';

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

describe('StakingList stake rows use the shared Button base', () => {
    it('gives every row button the kit base, one variant and one size beside the row class', async () => {
        renderList();
        const rows = await screen.findAllByRole('button', { name: /^Open / });
        expect(rows).toHaveLength(2);
        expect(buttonStyles.btn).toBeTruthy();
        for (const row of rows) {
            expect(row.classList.contains(buttonStyles.btn)).toBe(true);
            expect(row.classList.contains(buttonStyles.ghost)).toBe(true);
            expect(row.classList.contains(buttonStyles.lg)).toBe(true);
            expect(row.classList.contains(local.row)).toBe(true);
        }
    });

    it('keeps the row names and one button per list item', async () => {
        renderList();
        await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
        for (const item of screen.getAllByRole('listitem')) {
            const buttons = within(item).getAllByRole('button');
            expect(buttons).toHaveLength(1);
            expect(buttons[0].tagName).toBe('BUTTON');
            expect(buttons[0].getAttribute('aria-label')).toMatch(/^Open Validator stake, (10|20) XCHAIN, bc1q/);
        }
    });
});
