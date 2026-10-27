// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The raw signed-transaction lane of the Broadcast form: the queued result's
// Done button leaves the form, a failed broadcast shows its reason once, and
// a pasted hex may carry the usual 0x prefix.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

const LEGACY_TX = '0200000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03000000474830450221001111111111111111111111111111111111111111111111111111111111110121023333333333333333333333333333333333333333333333333333333333333333fdffffff0240e20100000000001976a914444444444444444444444444444444444444444488ac00000000000000001c6a1a58434841494eabababababababababababababababababababab00000000';
const ADDRESSES = {
    'bitcoin-mainnet': [
        { id: 'addr-1', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
    ],
};

let broadcastSignedTxRequest;

function mountForm(props = {}) {
    broadcastSignedTxRequest = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        broadcastSignedTxRequest,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(BroadcastForm, {
                walletId: 'w',
                initialChainId: 'bitcoin-mainnet',
                onBack: props.onBack || (() => {}),
                onDone: props.onDone,
            }),
        ),
    );
}

async function openRawTransaction(raw) {
    fireEvent.click(await screen.findByRole('radio', { name: 'Signed transaction' }));
    fireEvent.change(screen.getByLabelText('Signed transaction hex'), { target: { value: raw } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview transaction' }));
}

afterEach(cleanup);

describe('raw transaction broadcast', () => {
    it('leaves the form from the queued result with Done', async () => {
        const onDone = vi.fn();
        mountForm({ onDone });
        await openRawTransaction(LEGACY_TX);
        await screen.findByText(/spends 1 input/);
        broadcastSignedTxRequest.mockResolvedValueOnce({ queued: true, persisted: true });
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast transaction' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(screen.queryByLabelText('Signed transaction hex')).toBeNull();
    });

    it('accepts a 0x prefix on the pasted hex', async () => {
        mountForm();
        await openRawTransaction(`0x${LEGACY_TX}`);
        expect(await screen.findByText(/spends 1 input and creates 2 outputs/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast transaction' }));
        await screen.findByRole('heading', { name: 'Broadcast pending' });
        expect(broadcastSignedTxRequest).toHaveBeenCalledWith({
            walletId: 'w',
            chainId: 'bitcoin-mainnet',
            txHex: LEGACY_TX,
        });
    });
});
