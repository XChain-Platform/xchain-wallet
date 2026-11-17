// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { SignerSelectForm } from '../../../packages/core/src/shared/routes/SignerSelectForm.jsx';

afterEach(() => { cleanup(); resetWalletModes(); });

const HARDWARE_SIGNER = {
    id: 'signer-ledger',
    kind: 'ledger',
    vendor: 'Ledger',
    model: 'Nano X',
    label: 'Travel Ledger',
    firmwareVersion: '2.2.4',
};

function mount({
    list = [],
    value = null,
    onChange = vi.fn(),
    walletMode = 'full',
} = {}) {
    const listSigners = vi.fn().mockResolvedValue(list);
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
    const getSettings = vi.fn().mockResolvedValue({});
    const view = render(
        <MessagingProvider shell="web" messaging={{ listSigners, getSettings }}>
            <SignerSelectForm walletId="wallet-1" value={value} onChange={onChange} />
        </MessagingProvider>,
    );
    return { ...view, listSigners, onChange };
}

describe('SignerSelectForm optional callback safety', () => {
    it('settles an empty signer list when no change callback is provided', async () => {
        const listSigners = vi.fn().mockResolvedValue([]);
        const getSettings = vi.fn().mockResolvedValue({ walletMode: 'full' });

        render(
            <MessagingProvider shell="web" messaging={{ listSigners, getSettings }}>
                <SignerSelectForm walletId="wallet-1" value="stale-signer" />
            </MessagingProvider>,
        );

        await waitFor(() => expect(listSigners).toHaveBeenCalledWith('wallet-1'));
    });

    it('clears a selected hardware signer that is no longer paired', async () => {
        const onChange = vi.fn();
        mount({ list: [HARDWARE_SIGNER], value: 'missing-signer', onChange });

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
        expect(screen.getByRole('button', { name: /^Sign with: / })).not.toHaveAccessibleName(/Software wallet/i);
    });
});

describe('SignerSelectForm option guidance', () => {
    it('explains software and hardware behavior and selects the device id', async () => {
        const onChange = vi.fn();
        mount({ list: [HARDWARE_SIGNER], onChange });

        // The themed icon dropdown (G44): no radio list, and the trigger shows
        // the chosen signer with its line under the name.
        const trigger = await screen.findByRole('button', { name: 'Sign with: Software wallet (this seed)' });
        expect(screen.queryByRole('radio')).toBeNull();
        expect(trigger).toHaveTextContent(/Uses this wallet's recovery phrase/i);

        fireEvent.focus(screen.getByRole('button', { name: 'About Sign with' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent(/doesn't share your recovery phrase or private keys/i);
        fireEvent.keyDown(document, { key: 'Escape' });

        fireEvent.click(trigger);
        const ledger = screen.getByRole('option', { name: /Travel Ledger/i });
        expect(ledger).toHaveTextContent(/Hardware wallet: connect Ledger Nano X and approve there/i);
        expect(ledger).toHaveTextContent('firmware 2.2.4');
        fireEvent.click(ledger);
        expect(onChange).toHaveBeenCalledWith('signer-ledger');
    });

    it('names an unlabelled signer by product name, never raw vendor and model codes', async () => {
        mount({ list: [{ id: 'signer-trezor', kind: 'trezor', vendor: 'trezor', model: 'T' }], value: 'signer-trezor' });

        const trigger = await screen.findByRole('button', { name: /^Sign with: / });
        expect(trigger).toHaveTextContent('Trezor Model T');
        expect(trigger).toHaveTextContent(/connect Trezor Model T and approve there/i);
        expect(trigger).not.toHaveTextContent(/trezor T\b(?! )/);
    });

    it('states that choosing a key source does not stop another phone signing', async () => {
        mount({ list: [HARDWARE_SIGNER], walletMode: 'watcher' });

        const note = await screen.findByRole('note');
        expect(note).toHaveTextContent(
            /Another phone still signs for this wallet.*doesn't let this wallet sign transactions/i,
        );
        // A note is a warning card line, never a loose notice.
        expect(note.querySelector('[data-warning-line]')).not.toBeNull();
    });
});
