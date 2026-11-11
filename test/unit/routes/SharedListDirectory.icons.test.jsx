// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';

const CHAIN = 'bitcoin-mainnet';

function entry(index, extra = {}) {
    return {
        kind: 'home',
        home_chain: 'BTC',
        home_list_index: index,
        type: 1,
        owner: 'bc1qordinaryowner1234567890',
        member_count: 4,
        share_block: 102,
        bindTarget: 1000 + index,
        maintainedByPlatform: false,
        ...extra,
    };
}

function mount({ lists, unavailable = [], mode = 'pick', onOpenList } = {}) {
    const messaging = { getSharedLists: vi.fn().mockResolvedValue({ lists, unavailable }) };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SharedListDirectory
                walletId="wallet-1"
                chainId={CHAIN}
                mode={mode}
                filterType="token"
                onSelect={() => {}}
                onOpenList={onOpenList}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('SharedListDirectory buttons and home network', () => {
    it('draws an icon on Choose list and Load more', async () => {
        mount({ lists: Array.from({ length: 22 }, (_, index) => entry(index + 1)) });

        const choose = (await screen.findAllByRole('button', { name: 'Choose list' }))[0];
        expect(choose.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Load more' }).querySelector('svg')).not.toBeNull();
    });

    it('draws an icon on Open list', async () => {
        mount({ mode: 'browse', lists: [entry(1)], onOpenList: vi.fn() });

        expect((await screen.findByRole('button', { name: 'Open list' })).querySelector('svg')).not.toBeNull();
    });

    it('shows only the chain icon for the home network, never the chain name', async () => {
        mount({ lists: [entry(1)] });

        const row = await screen.findByRole('listitem');
        const home = within(row).getByText('Home network').nextElementSibling;
        expect(home.querySelector('svg, img, [role="img"]')).not.toBeNull();
        expect(home.textContent.trim()).toBe('');
    });

    it('shows no chain names in the unavailable notice', async () => {
        mount({ lists: [], unavailable: ['litecoin-mainnet'] });

        const notice = await screen.findByText(/Unavailable/);
        expect(notice.textContent).not.toMatch(/Litecoin|LTC/i);
        fireEvent.click(document.body);
    });
});
