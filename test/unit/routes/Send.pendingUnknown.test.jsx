// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A coin balance read while the tracker's mempool view was still converging
// carries `pendingUnknown`. Send keeps the available amount and adds one
// caveat under the amount field; a read without the marker shows no caveat.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

function makeMessaging(native) {
    const balances = { native, tokens: [] };
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue(balances),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ address: FROM, balances, error: null }],
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', grace: { testSendThresholdSats: 0 } }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function mount(native) {
    const send = React.createElement(Send, { walletId: 'w', onBack() {}, onReceive: vi.fn() });
    render(React.createElement(MessagingProvider, { shell: 'web', messaging: makeMessaging(native) }, send));
}

afterEach(() => cleanup());

describe('Send available amount while the pending side is unknown', () => {
    it('keeps the available amount and adds the caveat', async () => {
        mount({ tick: 'BTC', quantity: '100000000', divisibility: 8, pendingUnknown: true });
        expect(await screen.findByText(/1 BTC available/, {}, { timeout: 10_000 })).toBeInTheDocument();
        expect(screen.getByTestId('send-pending-unknown')).toHaveTextContent('still catching up on unconfirmed transactions');
    });

    it('shows no caveat when the read carries no marker', async () => {
        mount({ tick: 'BTC', quantity: '100000000', divisibility: 8 });
        expect(await screen.findByText(/1 BTC available/, {}, { timeout: 10_000 })).toBeInTheDocument();
        expect(screen.queryByTestId('send-pending-unknown')).toBeNull();
    });
});
