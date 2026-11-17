// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The form error standard on Send: one press of Send lists every problem in
// the notice at the top, each failing field is outlined, changing one field
// clears only that field, and the next press validates again.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const ALICE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function mount() {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'w', onBack() {} }),
    ));
    return messaging;
}

afterEach(() => { cleanup(); resetWalletModes(); });

describe('Send form errors', () => {
    it('lists every problem at once, outlines the failing fields, and clears only the field that changed', async () => {
        const messaging = mount();
        const destination = await screen.findByLabelText(/^To$/);
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        const notice = await screen.findByRole('alert', { name: 'Form errors' });
        expect(within(notice).getByText('Enter a recipient address.')).toBeInTheDocument();
        expect(within(notice).getByText('Amount must be a positive number.')).toBeInTheDocument();
        expect(notice).toHaveTextContent(/Fix \d things? to continue/);
        expect(destination).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText(/^Amount \(/)).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        // Typing a recipient clears the To entry only; the amount stays flagged.
        fireEvent.change(destination, { target: { value: ALICE } });
        const after = screen.getByRole('alert', { name: 'Form errors' });
        expect(within(after).queryByText('Enter a recipient address.')).toBeNull();
        expect(within(after).getByText('Amount must be a positive number.')).toBeInTheDocument();
        expect(destination).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText(/^Amount \(/)).toHaveAttribute('aria-invalid', 'true');

        // Fixing the last one removes the notice.
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.001' } });
        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();
    });
});
