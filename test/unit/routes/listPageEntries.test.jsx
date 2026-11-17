// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The optional list-page entries render only when their handler is passed
// and call it on click.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

function makeMessaging() {
    return {
        getListByActionIndex: vi.fn().mockResolvedValue({
            type: '2', status: 'valid', source: 'bc1qowner', list: ['bc1qmember'],
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue([]),
    };
}

function renderDetail(props) {
    render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <ListDetail chainId="bitcoin-mainnet" actionIndex="7" onBack={() => {}} onFork={() => {}} {...props} />
        </MessagingProvider>,
    );
    return screen.findByRole('button', { name: /^Fork\b/ });
}

function renderMyLists(props) {
    return render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

describe('ListDetail entries', () => {
    it('renders neither extra action row when no handler is passed', async () => {
        await renderDetail({});
        expect(screen.queryByRole('button', { name: /^Share\b/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Transfer\b/ })).toBeNull();
    });

    it('shows Share only when onShare is passed and calls it with the list ref', async () => {
        const onShare = vi.fn();
        await renderDetail({ onShare });
        expect(screen.queryByRole('button', { name: /^Transfer\b/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Share\b/ }));
        expect(onShare).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
    });

    it('shows Transfer only when onTransfer is passed and calls it with the list ref', async () => {
        const onTransfer = vi.fn();
        await renderDetail({ onTransfer });
        expect(screen.queryByRole('button', { name: /^Share\b/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Transfer\b/ }));
        expect(onTransfer).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
    });
});

describe('MyLists entries', () => {
    // Operator 2026-11-13: the title bar plus is Create list, and there is no
    // Create union list or Shared lists entry on the page (Shared with me is
    // the filter's Show choice).
    it('makes the title bar plus Create list and calls it on click', async () => {
        const onCreateList = vi.fn();
        renderMyLists({ onCreateList });
        const plus = await screen.findByRole('button', { name: 'Create list' });
        fireEvent.click(plus);
        expect(onCreateList).toHaveBeenCalledTimes(1);
    });

    it('renders no Create union list or Shared lists entry even when the shell passes them', async () => {
        renderMyLists({ onCreateList: () => {}, onCreateUnionList: vi.fn(), onOpenSharedLists: vi.fn() });
        await screen.findByRole('button', { name: 'Create list' });
        expect(screen.queryByText('Create Union List')).toBeNull();
        expect(screen.queryByText('Shared Lists')).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
