// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The three name forms follow the app-wide form rules: the submit names its
// action and carries an icon (U63), every label has its '?' tip (U57) and a
// length-limited name shows its counter on the label line (U56).

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { RenameWalletForm } = await import('../../../packages/core/src/shared/routes/RenameWalletForm.jsx');
const { RenameAccountForm } = await import('../../../packages/core/src/shared/routes/RenameAccountForm.jsx');
const { AddAccountForm } = await import('../../../packages/core/src/shared/routes/AddAccountForm.jsx');
const { NAME_MAX_LENGTH } = await import('../../../packages/core/src/util/display_name.js');

beforeEach(() => {
    messaging = {
        listWallets: vi.fn().mockResolvedValue([{ id: 'w1', name: 'Primary' }]),
        renameWallet: vi.fn().mockResolvedValue({ id: 'w1', name: 'Spending' }),
        listAccounts: vi.fn().mockResolvedValue([]),
        renameAccount: vi.fn().mockResolvedValue({ id: 'a1', name: 'Spending' }),
        listSigners: vi.fn().mockResolvedValue([]),
        createAccount: vi.fn().mockResolvedValue({ account: { id: 'a2' } }),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const RENAMES = [
    {
        label: 'Rename wallet',
        field: 'Wallet name',
        node: () => <RenameWalletForm walletId="w1" initialName="Primary" onBack={vi.fn()} onRenamed={vi.fn()} />,
        tip: /wallet picker and on the lock screen/,
    },
    {
        label: 'Rename account',
        field: 'Account name',
        node: () => <RenameAccountForm accountId="a1" walletId="w1" initialName="Main" onBack={vi.fn()} onRenamed={vi.fn()} />,
        tip: /account picker/,
    },
];

for (const form of RENAMES) {
    describe(`${form.label} follows the shared form rules`, () => {
        it('names its green submit after the action and gives it an icon', async () => {
            render(form.node());
            const submit = await screen.findByRole('button', { name: form.label });
            expect(submit.getAttribute('type')).toBe('submit');
            expect(submit.className).toMatch(/success/);
            expect(submit.querySelector('svg')).toBeTruthy();
            expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
        });

        it('carries a help tip written for this form on the name label', async () => {
            render(form.node());
            fireEvent.click(await screen.findByRole('button', { name: `About ${form.field}` }));
            expect(screen.getByRole('tooltip')).toHaveTextContent(form.tip);
        });

        it('shows the name length counter on the label line', async () => {
            render(form.node());
            const input = await screen.findByLabelText(form.field, { selector: 'input' });
            expect(input).toHaveAttribute('maxLength', String(NAME_MAX_LENGTH));
            await waitFor(() => expect(screen.getByText(`${input.value.length} / ${NAME_MAX_LENGTH}`)).toBeTruthy());
            fireEvent.change(input, { target: { value: 'Spending' } });
            expect(screen.getByText(`8 / ${NAME_MAX_LENGTH}`)).toBeTruthy();
        });
    });
}

describe('Add account follows the shared form rules', () => {
    it('shows the account name counter and keeps its help tip', async () => {
        render(<AddAccountForm walletId="w1" onBack={vi.fn()} onCreated={vi.fn()} />);
        const input = screen.getByLabelText('Account name', { selector: 'input' });
        expect(input).toHaveAttribute('maxLength', String(NAME_MAX_LENGTH));
        fireEvent.change(input, { target: { value: 'Savings' } });
        expect(screen.getByText(`7 / ${NAME_MAX_LENGTH}`)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Account name' })).toBeTruthy();
        const submit = screen.getByRole('button', { name: 'Add account' });
        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).toBeTruthy();
    });
});
