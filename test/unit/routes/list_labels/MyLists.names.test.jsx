// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../../packages/core/src/shared/routes/MyLists.jsx';

function renderLists(rows) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-testnet': [{ address: 'tb1qexampleaddress0000000000000000000000' }],
        }),
        getListsForSource: vi.fn().mockResolvedValue({ data: rows }),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
}

const row = (extra) => ({ type: '1', status: 'valid', block_index: 5, action_index: 12, ...extra });

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('MyLists row names', () => {
    it('shows a named token list with its name and matching aria-label', async () => {
        renderLists([row({ name: 'Payroll' })]);

        expect(await screen.findByText('Payroll (Token list #12)')).toBeTruthy();
        expect(screen.getByLabelText('Open Payroll (token list #12)')).toBeTruthy();
    });

    it('shows an unnamed address list as today', async () => {
        renderLists([row({ type: '2', action_index: 13 })]);

        expect(await screen.findByText('Address list #13')).toBeTruthy();
        expect(screen.getByLabelText('Open address list #13')).toBeTruthy();
    });

    it.each([
        ['empty', { name: '' }],
        ['non-string', { name: 42 }],
        ['null', { name: null }],
    ])('renders a %s name as unnamed', async (_case, extra) => {
        renderLists([row(extra)]);

        expect(await screen.findByText('Token list #12')).toBeTruthy();
        expect(screen.getByLabelText('Open token list #12')).toBeTruthy();
    });

    it('neutralizes a right-to-left override in the name', async () => {
        const rlo = String.fromCharCode(0x202E);
        renderLists([row({ name: `Safe${rlo}name` })]);

        expect(await screen.findByText('Safe␦name (Token list #12)')).toBeTruthy();
        expect(screen.getByLabelText('Open Safe␦name (token list #12)')).toBeTruthy();
    });
});
