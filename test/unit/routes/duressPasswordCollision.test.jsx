// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The duress passphrase is a device record, so a wallet created, imported,
// paired or migrated on a device that holds one can take it as its password.
// The Locked screen tries the real unlock first, so that password then opens
// the wallet when it is typed under duress and arms nothing. Every form that
// sets a wallet password refuses the duress passphrase with the sentence the
// change-password form gives, and calls nothing.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { PairPartnerWallet } from '../../../packages/core/src/shared/routes/PairPartnerWallet.jsx';
import { MigrateToBip39 } from '../../../packages/core/src/shared/routes/MigrateToBip39.jsx';
import {
    DURESS_PASSWORD_COLLISION_MESSAGE,
    __resetDuressPersistenceForTests,
    clearDuressPassphrase,
    setDuressPassphrase,
} from '../../../packages/core/src/flows/duressPassphrase.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
const DURESS = 'duress-passphrase-9';
const OTHER = 'correct-horse-battery';

beforeEach(() => {
    localStorage.clear();
    __resetDuressPersistenceForTests();
    setDuressPassphrase(DURESS);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearDuressPassphrase();
    __resetDuressPersistenceForTests();
    localStorage.clear();
});

function mount(node, messaging) {
    return render(<MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>);
}

function setPasswords(passwordLabel, confirmLabel, value) {
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value } });
    fireEvent.change(screen.getByLabelText(confirmLabel), { target: { value } });
}

describe('create wallet', () => {
    function submit(password) {
        mount(<CreateWallet onBack={() => {}} onCreated={() => {}} />, {});
        setPasswords('Password', /^Confirm( password)?$/, password);
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }

    it('refuses the duress passphrase as the wallet password', () => {
        submit(DURESS);
        expect(screen.getByRole('alert')).toHaveTextContent(DURESS_PASSWORD_COLLISION_MESSAGE);
        expect(screen.queryByRole('button', { name: 'Reveal recovery phrase' })).toBeNull();
    });

    it('accepts any other password', () => {
        submit(OTHER);
        expect(screen.getByRole('button', { name: 'Reveal recovery phrase' })).toBeTruthy();
    });
});

describe('import wallet', () => {
    function mountImport() {
        const importMnemonic = vi.fn(async () => ({ walletId: 'w-1' }));
        mount(<ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />, {
            importMnemonic,
            listWallets: vi.fn(async () => []),
        });
        return importMnemonic;
    }

    it('refuses the duress passphrase on a recovery phrase import', async () => {
        const importMnemonic = mountImport();
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        setPasswords('Password', 'Confirm password', DURESS);
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(DURESS_PASSWORD_COLLISION_MESSAGE);
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('refuses the duress passphrase on a private key import', async () => {
        const importMnemonic = mountImport();
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        fireEvent.change(screen.getByLabelText('WIF private key'), { target: { value: WIF } });
        fireEvent.click(screen.getByLabelText("I understand this key isn't recoverable from a recovery phrase."));
        setPasswords('Password', 'Confirm password', DURESS);
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(DURESS_PASSWORD_COLLISION_MESSAGE);
        expect(importMnemonic).not.toHaveBeenCalled();
    });
});

describe('pair a partner wallet', () => {
    it('refuses the duress passphrase as the password for this device', async () => {
        const importMnemonic = vi.fn(async () => ({ wallet: { id: 'w-1' } }));
        mount(<PairPartnerWallet />, { importMnemonic });
        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
        fireEvent.change(screen.getByLabelText(/Shared recovery phrase/i), { target: { value: PHRASE } });
        setPasswords(/^Password for this device$/i, /Confirm password/i, DURESS);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });

        expect(screen.getByText(DURESS_PASSWORD_COLLISION_MESSAGE)).toBeInTheDocument();
        expect(importMnemonic).not.toHaveBeenCalled();
    });
});

describe('migrate to a BIP39 wallet', () => {
    it('refuses the duress passphrase as the new wallet password', async () => {
        const addImportedWallet = vi.fn();
        mount(
            <MigrateToBip39 legacyWalletId="wallet-old" onBack={() => {}} onMigrated={() => {}} onSweepChain={() => {}} />,
            { getAddressesByChain: vi.fn(async () => ({})), addImportedWallet },
        );
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        setPasswords('Password', 'Confirm password', DURESS);
        fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));

        expect(await screen.findByText(DURESS_PASSWORD_COLLISION_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1, name: 'Write down your recovery phrase' })).toBeNull();
        expect(addImportedWallet).not.toHaveBeenCalled();
    });
});
