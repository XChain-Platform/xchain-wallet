// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every button on My lists carries an icon (U63).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

describe('MyLists page actions', () => {
    it('gives the filter and the Create list plus an icon', async () => {
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
        // The title bar holds only the filter and the Create list plus, each an
        // icon button; Shared lists and Create union list are gone (operator
        // 2026-11-13).
        for (const name of ['Filter lists', 'Create list']) {
            const button = screen.getByRole('button', { name });
            expect(button.querySelector('svg'), name).not.toBeNull();
        }
        expect(screen.queryByRole('button', { name: 'Shared Lists' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create Union List' })).toBeNull();
    });
});
