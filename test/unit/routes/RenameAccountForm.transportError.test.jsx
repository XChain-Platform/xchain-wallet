// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { RenameAccountForm } = await import(
    '../../../packages/core/src/shared/routes/RenameAccountForm.jsx');

function mount() {
    render(
        <RenameAccountForm
            accountId="account-1"
            walletId="wallet-1"
            initialName="Primary account"
            onBack={vi.fn()}
            onRenamed={vi.fn()}
        />,
    );
}

beforeEach(() => {
    messaging = {
        listAccounts: vi.fn().mockResolvedValue([]),
        renameAccount: vi.fn(),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('RenameAccountForm transport failures', () => {
    it.each([
        new Error('Request failed with status code 500'),
        new TypeError('Failed to fetch'),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
    ])('hides raw transport text and keeps the entered name for retry', async (failure) => {
        messaging.renameAccount.mockRejectedValue(failure);
        mount();
        const input = screen.getByLabelText('Account name');
        fireEvent.change(input, { target: { value: 'Retried account' } });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findAllByText('Failed to rename account.')).toHaveLength(1);
        expect(screen.queryByText(failure.message)).toBeNull();
        expect(input.value).toBe('Retried account');
    });

    it('preserves a host validation message and the entered name', async () => {
        const failure = new Error('That account name is reserved.');
        messaging.renameAccount.mockRejectedValue(failure);
        mount();
        const input = screen.getByLabelText('Account name');
        fireEvent.change(input, { target: { value: 'Reserved account' } });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findAllByText(failure.message)).toHaveLength(1);
        expect(input.value).toBe('Reserved account');
    });
});
