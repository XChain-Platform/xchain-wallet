// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Create multisig requires a master fingerprint for the local cosigner,
// and nothing in the UI showed one, so no multisig could be created. This
// drives the real form: picking one of the wallet's addresses must fill the
// fingerprint from the host, a failed read must leave the field editable
// with a reason, and "Share this wallet as a cosigner" must show the values
// the other party pastes in.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MultisigCreate } from '../../../packages/core/src/shared/routes/MultisigCreate.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const ADDRESS = {
    id: 'addr-1',
    address: 'tb1qlocalcosigner',
    label: '',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/1'/0'/0/0",
    signerId: null,
};

const INFO = {
    fingerprint: '73c5da0a',
    derivationPath: "m/84'/1'/0'/0/0",
    accountPath: "m/84'/1'/0'",
    xpub: 'xpub6ExampleAccountKey',
    pubkey: '02'.padEnd(66, 'a'),
    addressId: 'addr-1',
    address: 'tb1qlocalcosigner',
};

function mkMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn(async () => ({ 'bitcoin-testnet': [ADDRESS] })),
        getMultisigCosignerInfo: vi.fn(async () => INFO),
        createMultisigConfig: vi.fn(async () => ({})),
        ...overrides,
    };
}

async function mount(messaging) {
    await act(async () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MultisigCreate, { walletId: 'w-1', onBack: () => {} }),
        ));
    });
}

async function pickLocalAddress() {
    await act(async () => {
        fireEvent.change(screen.getByLabelText(/Use one of this wallet's addresses/i), { target: { value: 'addr-1' } });
    });
}

afterEach(() => cleanup());

describe('MultisigCreate local cosigner', () => {
    it('auto-fills the master fingerprint from the unlocked wallet', async () => {
        const messaging = mkMessaging();
        await mount(messaging);
        await pickLocalAddress();

        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledWith({ walletId: 'w-1', addressId: 'addr-1' });
        const [localFingerprint] = screen.getAllByLabelText(/Master fingerprint/i);
        expect(localFingerprint.value).toBe('73c5da0a');
        const [localPubkey] = screen.getAllByLabelText(/Public key \(hex/i);
        expect(localPubkey.value).toBe(ADDRESS.publicKey);
    });

    it('leaves the fingerprint editable with the reason when the read fails', async () => {
        const messaging = mkMessaging({
            getMultisigCosignerInfo: vi.fn(async () => { throw new Error('This wallet\'s keys are not unlocked in this session.'); }),
        });
        await mount(messaging);
        await pickLocalAddress();

        const [localFingerprint] = screen.getAllByLabelText(/Master fingerprint/i);
        expect(localFingerprint.value).toBe('');
        expect(screen.getByText(/Enter it by hand/)).toBeTruthy();
    });

    it('refuses a second local cosigner in the form', async () => {
        await mount(mkMessaging());
        const origins = screen.getAllByLabelText(/^Origin/i);
        await act(async () => {
            fireEvent.change(origins[1], { target: { value: 'local' } });
        });
        expect(screen.getByText(/Only one cosigner can be this wallet's own key/)).toBeTruthy();
    });
});

describe('MultisigCreate share as cosigner', () => {
    it('shows the xpub, pubkey, fingerprint and path for a chosen address', async () => {
        const messaging = mkMessaging();
        await mount(messaging);
        await act(async () => {
            fireEvent.change(screen.getByLabelText(/Address to share/i), { target: { value: 'addr-1' } });
        });

        expect(screen.getByTestId('cosigner-share-xpub').textContent).toBe(INFO.xpub);
        expect(screen.getByTestId('cosigner-share-public-key').textContent).toBe(INFO.pubkey);
        expect(screen.getByTestId('cosigner-share-master-fingerprint').textContent).toBe('73c5da0a');
        expect(screen.getByTestId('cosigner-share-derivation-path').textContent).toBe(INFO.derivationPath);
        expect(screen.getByRole('button', { name: 'Copy xpub' })).toBeTruthy();
    });
});
