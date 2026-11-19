// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware wallet has no seed, so Add Account pins the new account to the
// wallet's own device and hides the signer picker; a software wallet keeps it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => <p>Signer picker</p>,
}));

const { AddAccountForm } = await import('../../../packages/core/src/shared/routes/AddAccountForm.jsx');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

async function mountFor(wallet) {
    messaging = {
        listAccounts: vi.fn().mockResolvedValue([{ id: 'a1', index: 0, name: 'Account 1' }]),
        listWallets: vi.fn().mockResolvedValue([wallet]),
        listSigners: vi.fn().mockResolvedValue([{ id: 'sig-1', walletId: wallet.id, vendor: 'ledger' }]),
        createAccount: vi.fn().mockResolvedValue({ account: { id: 'a2' } }),
    };
    await act(async () => {
        render(<AddAccountForm walletId={wallet.id} onBack={() => {}} onCreated={() => {}} />);
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
}

describe('AddAccountForm on a hardware wallet', () => {
    it('hides the picker and adds the account on the wallet\'s device', async () => {
        await mountFor({ id: 'hw-1', format: 'hardware' });
        expect(screen.queryByText('Signer picker')).toBeNull();
        await act(async () => {
            fireEvent.submit(screen.getByLabelText('Account name', { selector: 'input' }).closest('form'));
        });
        expect(messaging.createAccount).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'hw-1', signerId: 'sig-1' }));
    });

    it('keeps the picker on a software wallet', async () => {
        await mountFor({ id: 'soft-1', format: 'bip39' });
        expect(screen.getByText('Signer picker')).toBeInTheDocument();
        expect(messaging.listSigners).not.toHaveBeenCalled();
    });
});
