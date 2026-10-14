// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Error copy on the Add account form, asserted against the rendered DOM.
// The createAccount flow throws "createAccount: ..." precondition errors that
// cross the messaging boundary intact, so the form must filter them.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => null,
}));

const { AddAccountForm } = await import(
    '../../../packages/core/src/shared/routes/AddAccountForm.jsx');

const FALLBACK = /Lock and unlock your wallet, then try again/;

beforeEach(() => {
    messaging = {
        listAccounts: vi.fn().mockResolvedValue([]),
        createAccount: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Render the form, submit it, and wait for the error the submit produced.
async function submitAndReadError(text) {
    render(<AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Savings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    return screen.findByText(text);
}

describe('AddAccountForm error copy', () => {
    it('replaces the missing-signer precondition error with recovery copy', async () => {
        messaging.createAccount.mockRejectedValue(
            new Error('createAccount: either `signer` or `password` is required'));

        expect(await submitAndReadError(FALLBACK)).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/createAccount:/);
    });

    it('replaces the unknown-chain precondition error with recovery copy', async () => {
        messaging.createAccount.mockRejectedValue(new Error('createAccount: unknown chain "foo"'));

        expect(await submitAndReadError(FALLBACK)).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/unknown chain/);
    });

    it('keeps copy that was already written for the user', async () => {
        messaging.createAccount.mockRejectedValue(new Error('An account named "Savings" already exists.'));

        expect(await submitAndReadError('An account named "Savings" already exists.')).toBeTruthy();
    });

    it('explains a shell without account creation in plain words', async () => {
        messaging.createAccount = undefined;

        expect(await submitAndReadError('Adding accounts is not available in this shell.')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/messaging\.createAccount/);
    });
});
