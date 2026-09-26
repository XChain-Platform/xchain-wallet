// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const WRONG_NETWORK = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

function messaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'source-1', address: SOURCE, source: 'hd', role: 'receive',
                publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0",
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', language: 'en', display: {} }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'TOKEN', divisibility: 0, locks: {} }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getListsForSource: vi.fn().mockResolvedValue([]),
        searchTokens: vi.fn().mockResolvedValue([]),
    };
}

function mount(component) {
    render(
        <MessagingProvider shell="web" messaging={messaging()}>
            {component}
        </MessagingProvider>,
    );
}

async function expectSkippedAddressDisclosure() {
    const textarea = await screen.findByPlaceholderText(/Paste addresses/);
    fireEvent.change(textarea, { target: { value: WRONG_NETWORK } });
    const summary = await screen.findByText('Skipped addresses (1)');
    fireEvent.click(summary);
    const details = summary.closest('details');
    expect(details).toHaveTextContent(WRONG_NETWORK);
    expect(details).toHaveTextContent(/Does not belong to Bitcoin/);
}

afterEach(() => cleanup());

describe('wrong-network recipient diagnostics', () => {
    it('lists skipped addresses on the airdrop screen', async () => {
        mount(<AirdropForm walletId="wallet-1" initialChainId={CHAIN} initialTick="TOKEN" onBack={() => {}} />);
        await expectSkippedAddressDisclosure();
    });

    it('lists skipped addresses on the create-list screen', async () => {
        mount(<ListCreateForm walletId="wallet-1" chainId={CHAIN} initialType="2" onBack={() => {}} />);
        await expectSkippedAddressDisclosure();
    });
});
