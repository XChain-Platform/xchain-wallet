// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Picking an own address on another chain switches Send's network and keeps
// the picked address. Send's source default effect re-defaults whenever the
// recorded pick chain differs from the form chain, so the pick has to be
// recorded against the chain it was made on, not the chain the picker opened on.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'litecoin-mainnet';
const SOURCE_A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SOURCE_B_ACTIVE = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';
const SOURCE_B_PICKED = 'ltc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3nmndwj';
const RECORD_B_PICKED = {
    id: 'addr-ltc-2',
    address: SOURCE_B_PICKED,
    publicKey: '02ef',
    derivationPath: "m/84'/2'/0'/0/2",
    source: 'hd',
};

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick }) => (
        <button type="button" onClick={() => onPick(RECORD_B_PICKED, CHAIN_B)}>
            Pick Litecoin source
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const ADDRESSES = {
    [CHAIN_A]: [{ id: 'addr-btc', address: SOURCE_A, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
    [CHAIN_B]: [
        { id: 'addr-ltc-1', address: SOURCE_B_ACTIVE, publicKey: '02cd', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' },
        RECORD_B_PICKED,
    ],
};

function mountSend() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_A]: { id: 'addr-btc', address: SOURCE_A },
            [CHAIN_B]: { id: 'addr-ltc-1', address: SOURCE_B_ACTIVE },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({ native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] }),
        getSettings: vi.fn().mockResolvedValue({ lastUsedChainId: CHAIN_A, grace: { testSendThresholdSats: 0 } }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
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
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Send walletId="w" prefill={{ chainId: CHAIN_A }} onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('Send cross-chain source picker', () => {
    it('switches the chain and keeps the picked source address over the chain default', async () => {
        mountSend();
        await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCE_A));

        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick Litecoin source' }));

        await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCE_B_PICKED));
        // The default effect has run on the new chain and left the pick alone.
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCE_B_PICKED);
    });
});
