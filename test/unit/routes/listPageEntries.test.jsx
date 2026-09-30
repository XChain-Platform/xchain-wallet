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
    return screen.findByText('Fork & edit');
}

function renderMyLists(props) {
    return render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

describe('ListDetail entries', () => {
    it('renders neither extra entry when no handler is passed', async () => {
        await renderDetail({});
        expect(screen.queryByText('Share list')).toBeNull();
        expect(screen.queryByText('Transfer list')).toBeNull();
    });

    it('shows Share list only when onShare is passed and calls it with the list ref', async () => {
        const onShare = vi.fn();
        await renderDetail({ onShare });
        expect(screen.queryByText('Transfer list')).toBeNull();
        fireEvent.click(screen.getByText('Share list'));
        expect(onShare).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
    });

    it('shows Transfer list only when onTransfer is passed and calls it with the list ref', async () => {
        const onTransfer = vi.fn();
        await renderDetail({ onTransfer });
        expect(screen.queryByText('Share list')).toBeNull();
        fireEvent.click(screen.getByText('Transfer list'));
        expect(onTransfer).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', actionIndex: '7' });
    });
});

describe('MyLists entries', () => {
    it('renders neither extra entry when no handler is passed', async () => {
        renderMyLists({ onCreateList: () => {} });
        await waitFor(() => expect(screen.getByLabelText('Create list')).toBeTruthy());
        expect(screen.queryByText('Create union list')).toBeNull();
        expect(screen.queryByText('Shared lists')).toBeNull();
    });

    it('shows Create union list only when passed and calls it on click', async () => {
        const onCreateUnionList = vi.fn();
        renderMyLists({ onCreateUnionList });
        expect(screen.queryByText('Shared lists')).toBeNull();
        fireEvent.click(screen.getByText('Create union list'));
        expect(onCreateUnionList).toHaveBeenCalledTimes(1);
    });

    it('shows Shared lists only when passed and calls it on click', async () => {
        const onOpenSharedLists = vi.fn();
        renderMyLists({ onOpenSharedLists });
        expect(screen.queryByText('Create union list')).toBeNull();
        fireEvent.click(screen.getByText('Shared lists'));
        expect(onOpenSharedLists).toHaveBeenCalledTimes(1);
    });
});
