// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A payment link for another network than the wallet is on opens Send with a
// source notice that points at the network switch in Settings. Receive cannot
// help there: the address the link needs lives on the other network.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const BTC = 'bitcoin-mainnet';
const TESTNET = 'bitcoin-testnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

function mount({ activeNetwork, prefill }) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork, grace: { testSendThresholdSats: 0 } }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
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
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {}, prefill }),
        ),
    );
}

afterEach(() => cleanup());

describe('Send opened by a link for another network', () => {
    it('says the link is for another network and points at Settings', async () => {
        mount({ activeNetwork: 'mainnet', prefill: { chainId: TESTNET, address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' } });
        const notice = await screen.findByText(/This payment link is for Testnet/);
        expect(notice.textContent).toMatch(/Switch networks in Settings to open it there/);
        expect(screen.queryByText(/Use Receive to generate one first/)).toBeNull();
    });

    it('keeps the Receive advice for a chain on the active network with no address', async () => {
        mount({ activeNetwork: 'testnet', prefill: { chainId: TESTNET } });
        await screen.findByText(/No address on this network\. Use Receive to generate one first\./);
        expect(screen.queryByText(/This payment link is for/)).toBeNull();
    });

    it('shows no notice when the link matches the active network', async () => {
        mount({ activeNetwork: 'mainnet', prefill: { chainId: BTC } });
        await waitFor(() => expect(screen.getByLabelText(/^To$/)).toBeTruthy());
        expect(screen.queryByText(/This payment link is for/)).toBeNull();
        expect(screen.queryByText(/No address on this network/)).toBeNull();
    });
});
