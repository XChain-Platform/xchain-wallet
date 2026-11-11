// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every button on My lists carries an icon (U63), Shared lists included:
// its label matches no auto-icon pattern, so the route passes one.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

describe('MyLists page actions', () => {
    it('gives Shared lists, Create union list and Create list an icon', async () => {
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qowner' }] }),
                getListsForSource: vi.fn().mockResolvedValue({
                    data: [{ action_index: '700001', name: 'Road trip', type: '2', status: 'valid', source: 'bc1qowner', block_index: 2 }],
                }),
            }}>
                <MyLists
                    walletId="w1"
                    onOpenList={() => {}}
                    onCreateList={() => {}}
                    onOpenSharedLists={() => {}}
                    onCreateUnionList={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Road trip/ })).toBeTruthy());
        for (const name of ['Shared lists', 'Create union list', 'Create list']) {
            const button = screen.getByRole('button', { name });
            expect(button.querySelector('svg'), name).not.toBeNull();
        }
    });
});
