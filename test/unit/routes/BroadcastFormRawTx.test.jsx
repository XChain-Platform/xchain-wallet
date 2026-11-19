// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Signed transaction submission belongs to Sign transaction, not Broadcast.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

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

afterEach(cleanup);

describe('BroadcastForm raw transaction removal', () => {
    it('keeps signed transaction submission on the Sign transaction route', async () => {
        mountForm();
        await screen.findByLabelText('Message');

        expect(screen.queryByText('What do you want to broadcast?')).toBeNull();
        expect(screen.queryByLabelText('Signed transaction')).toBeNull();
        expect(screen.queryByLabelText('Signed transaction code')).toBeNull();
        expect(broadcastSignedTxRequest).not.toHaveBeenCalled();
    });
});
