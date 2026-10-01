// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';

const CHAIN = 'bitcoin-mainnet';
const ENTRIES = [
    {
        kind: 'home',
        home_chain: 'BTC',
        home_list_index: 12,
        type: 1,
        owner: 'bc1qordinaryowner1234567890',
        member_count: 4,
        share_block: 102,
        bindTarget: 1012,
        maintainedByPlatform: false,
    },
    {
        kind: 'home',
        home_chain: 'LTC',
        home_list_index: 8,
        type: 2,
        owner: 'ltc1platformowner1234567890',
        member_count: 2,
        share_block: 88,
        bindTarget: 2008,
        maintainedByPlatform: true,
    },
    {
        kind: 'home',
        home_chain: 'DOGE',
        home_list_index: 4,
        type: 1,
        owner: 'DUnmirroredOwner',
        member_count: 1,
        share_block: 77,
        bindTarget: null,
        maintainedByPlatform: false,
    },
];

function mount({ mode = 'browse', filterType, onSelect = vi.fn(), response } = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSharedLists: vi.fn().mockResolvedValue(response ?? {
            lists: ENTRIES,
            unavailable: [],
        }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SharedListDirectory
                walletId="wallet-1"
                chainId={CHAIN}
                mode={mode}
                filterType={filterType}
                onSelect={onSelect}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, onSelect };
}

afterEach(cleanup);

describe('SharedListDirectory', () => {
    it('shows the platform badge and keeps unbadged lists in the directory', async () => {
        mount();

        expect(await screen.findByText('Maintained by XChain Platform')).toBeTruthy();
        expect(screen.getByRole('listitem', { name: /Token list 12 on BTC/ })).toBeTruthy();
        expect(screen.getByRole('listitem', { name: /Address list 8 on LTC/ })).toBeTruthy();
        expect(screen.getByText('bc1qor...7890')).toBeTruthy();
        expect(screen.getByText('not yet mirrored here')).toBeTruthy();
    });

    it('orders platform lists before the remaining home chains', async () => {
        mount();

        const rows = await screen.findAllByRole('listitem');
        expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
            'Address list 8 on LTC',
            'Token list 12 on BTC',
            'Token list 4 on DOGE',
        ]);
    });

    it('filters pick mode and returns the local bind target', async () => {
        const onSelect = vi.fn();
        const state = mount({ mode: 'pick', filterType: 'address', onSelect });

        const row = await screen.findByRole('listitem', { name: /Address list 8 on LTC/ });
        expect(screen.queryByRole('listitem', { name: /Token list 12 on BTC/ })).toBeNull();
        fireEvent.click(within(row).getByRole('button', { name: 'Choose list' }));

        expect(state.messaging.getSharedLists).toHaveBeenCalledWith({ chainId: CHAIN });
        expect(onSelect).toHaveBeenCalledWith({
            actionIndex: 2008,
            homeChain: 'LTC',
            homeListIndex: 8,
            memberCount: 2,
        });
    });

    it('does not offer an unmirrored list in pick mode', async () => {
        mount({ mode: 'pick', filterType: 'token' });

        expect(await screen.findByRole('listitem', { name: /Token list 12 on BTC/ })).toBeTruthy();
        expect(screen.queryByRole('listitem', { name: /Token list 4 on DOGE/ })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Choose list' })).toHaveLength(1);
    });

    it('renders one unavailable line for each failed chain', async () => {
        mount({
            response: {
                lists: [],
                unavailable: ['litecoin-mainnet', 'dogecoin-mainnet'],
            },
        });

        expect(await screen.findByText('Shared lists unavailable from Litecoin.')).toBeTruthy();
        expect(screen.getByText('Shared lists unavailable from Dogecoin.')).toBeTruthy();
    });
});
