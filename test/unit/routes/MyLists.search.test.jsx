// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The My lists search finds a list by the name and kind its row shows.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ address: 'bc1qowner' }],
        }),
        getListsForSource: vi.fn().mockResolvedValue({
            data: [
                { action_index: '700001', name: 'Road trip', type: '2', status: 'valid', source: 'bc1qowner', block_index: 2 },
                { action_index: '700002', name: 'Summer tokens', type: '1', status: 'valid', source: 'bc1qowner', block_index: 1 },
            ],
        }),
    };
}

async function renderRows() {
    render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Road trip/ })).toBeTruthy());
}

function search(text) {
    fireEvent.change(screen.getByLabelText('Search lists'), { target: { value: text } });
}

describe('MyLists search', () => {
    it('renders loading through StatusMessage before the page actions', () => {
        render(
            <MessagingProvider shell="extension" messaging={{
                getAddressesByChain: vi.fn(() => new Promise(() => {})),
            }}>
                <MyLists
                    walletId="w1"
                    onOpenList={() => {}}
                    onCreateList={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const notice = screen.getByRole('status');
        expect(notice).toHaveTextContent('Loading lists');
        expect(notice.parentElement.firstElementChild).toBe(notice);
    });

    it('finds a list by its name', async () => {
        await renderRows();
        search('road');
        expect(screen.getByRole('button', { name: /Road trip/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Summer tokens/ })).toBeNull();
    });

    it('finds lists by the kind shown on the row', async () => {
        await renderRows();
        search('token list');
        expect(screen.getByRole('button', { name: /Summer tokens/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Road trip/ })).toBeNull();
    });

    it('finds a list by the title text with its index', async () => {
        await renderRows();
        search('list #700001');
        expect(screen.getByRole('button', { name: /Road trip/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Summer tokens/ })).toBeNull();
    });
});
