// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Ticking "This wallet uses a BIP39 passphrase" and leaving the field
// empty must not import anything.
//
// The submit handler used to fold an empty passphrase into "no passphrase"
// and derive the passphrase-less wallet, so a tester who ticked the box and
// forgot the field landed on the same wrong addresses as one who never
// ticked it, with no hint why. A BIP39 passphrase has no checksum; the only
// point at which the wallet can catch the mistake is before it derives.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

function renderFilled(importMnemonic) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByLabelText(/This wallet uses a BIP39 passphrase/));
}

describe('a ticked passphrase box with an empty field refuses to import', () => {
    it('shows the instruction and never calls the flow', async () => {
        const importMnemonic = vi.fn().mockResolvedValue({});
        renderFilled(importMnemonic);

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await screen.findByText(/Enter the BIP39 passphrase, or uncheck the box/);
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('imports with the passphrase once one is typed', async () => {
        const importMnemonic = vi.fn().mockResolvedValue({});
        renderFilled(importMnemonic);
        fireEvent.change(screen.getByLabelText('BIP39 passphrase'), { target: { value: 'hunter2' } });

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(importMnemonic).toHaveBeenCalled());
        expect(importMnemonic.mock.calls[0][0].bip39Passphrase).toBe('hunter2');
    });

    it('imports without a passphrase when the box is left unticked', async () => {
        const importMnemonic = vi.fn().mockResolvedValue({});
        renderFilled(importMnemonic);
        fireEvent.click(screen.getByLabelText(/This wallet uses a BIP39 passphrase/));

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(importMnemonic).toHaveBeenCalled());
        expect(importMnemonic.mock.calls[0][0].bip39Passphrase).toBe('');
    });
});
