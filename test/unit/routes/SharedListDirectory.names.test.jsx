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

function entry(overrides = {}) {
    return {
        kind: 'home',
        home_chain: 'BTC',
        home_list_index: 12,
        type: 1,
        owner: 'bc1qordinaryowner1234567890',
        member_count: 4,
        share_block: 102,
        bindTarget: 1012,
        maintainedByPlatform: false,
        ...overrides,
    };
}

function mount({ entries, mode = 'browse', filterType, onSelect = vi.fn() }) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: entries, unavailable: [] }),
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
    return { onSelect };
}

afterEach(cleanup);

describe('SharedListDirectory names', () => {
    it('shows a Name row directly before Home chain for a named entry', async () => {
        mount({ entries: [entry({ name: 'Treasury assets' })] });

        const row = await screen.findByRole('listitem', { name: 'Token list 12 on BTC' });
        const terms = within(row).getAllByRole('term');
        expect(terms[0].textContent).toBe('Name');
        expect(terms[1].textContent).toBe('Home chain');
        expect(within(row).getByText('Treasury assets')).toBeTruthy();
    });

    it('shows no Name row for entries without a non-empty string name', async () => {
        mount({
            entries: [
                entry(),
                entry({ home_list_index: 13, bindTarget: 1013, name: '' }),
                entry({ home_list_index: 14, bindTarget: 1014, name: 42 }),
            ],
        });

        const rows = await screen.findAllByRole('listitem');
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(within(row).queryByText('Name')).toBeNull();
        }
    });

    it('neutralizes bidi controls in a displayed name', async () => {
        mount({ entries: [entry({ name: 'Safe\u202Ename' })] });

        expect(await screen.findByText('Safe\u2426name')).toBeTruthy();
        expect(screen.queryByText('Safe\u202Ename')).toBeNull();
    });

    it('includes a named entry name in the pick selection', async () => {
        const state = mount({
            entries: [entry({ name: 'Treasury assets' })],
            mode: 'pick',
            filterType: 'token',
        });

        const row = await screen.findByRole('listitem', { name: 'Token list 12 on BTC' });
        fireEvent.click(within(row).getByRole('button', { name: 'Choose list' }));

        expect(state.onSelect).toHaveBeenCalledWith({
            actionIndex: 1012,
            homeChain: 'BTC',
            homeListIndex: 12,
            memberCount: 4,
            name: 'Treasury assets',
        });
    });
});
