// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Lists screen holds review until every invalid or wrong-network line is
// removed, so its notes say the lines are invalid and must go, never that they
// were skipped: a skipped line would not block anything.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import bitcoin from 'bitcoinjs-lib';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const { runConfirm } = vi.hoisted(() => ({ runConfirm: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({ open: false, composing: false, confirmAction: {}, run: runConfirm }),
    };
});

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const address = (i, network = bitcoin.networks.bitcoin) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i + 1).padStart(40, '0'), 'hex'),
    network,
}).address;

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getActionFormats: vi.fn().mockResolvedValue({ 0: {} }),
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
            <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="2" onBack={() => {}} />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    __clearTokenInfoCache();
    runConfirm.mockReset();
});

afterEach(cleanup);

describe('ListCreateForm invalid and wrong-network lines', () => {
    it('counts them as invalid, says to remove them, and holds review', async () => {
        mount();
        await screen.findByLabelText('From');
        await new Promise((resolve) => setTimeout(resolve, 0));
        fireEvent.change(screen.getByLabelText('Addresses'), {
            target: { value: [address(0), address(1), address(2, bitcoin.networks.testnet), 'not an address'].join('\n') },
        });

        await waitFor(() => expect(screen.getByText(/2 valid addresses · 2 invalid/)).toBeInTheDocument());
        expect(document.body.textContent).not.toMatch(/invalid skipped/);
        expect(screen.getByText(/1 address is for another network\. This list is published on the selected network, so remove it to continue\./)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
        expect(await screen.findByText('Remove 2 invalid addresses before reviewing.')).toBeInTheDocument();
        expect(runConfirm).not.toHaveBeenCalled();
    });
});
