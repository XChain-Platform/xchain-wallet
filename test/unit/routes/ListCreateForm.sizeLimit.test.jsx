// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A pasted list of a few hundred addresses compiles past 8 KB. On a Taproot
// chain with a local key the Lists screen would let it through to compose, the
// encoder would move it into an envelope, and the reveal's repeating ITEM field
// is one the wallet cannot verify. The screen refuses before compose, naming
// the limit, how many addresses fit and how many were pasted.

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
        useActionConfirmFlow: () => ({
            open: false,
            composing: false,
            confirmAction: {},
            run: runConfirm,
        }),
    };
});

const BTC = 'bitcoin-mainnet';
// A local key with a compressed public key on a chain that does Taproot: the
// combination that would raise the ceiling to the envelope's 390000 bytes.
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const address = (i) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i + 1).padStart(40, '0'), 'hex'),
    network: bitcoin.networks.bitcoin,
}).address;
const addresses = (n) => Array.from({ length: n }, (_, i) => address(i));

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
    return messaging;
}

async function paste(list) {
    await screen.findByLabelText('From');
    await waitFor(() => expect(screen.getByLabelText('Addresses')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: list.join('\n') } });
}

beforeEach(() => {
    __clearTokenInfoCache();
    runConfirm.mockReset();
    runConfirm.mockRejectedValue(new Error('stop after compose assertion'));
});

afterEach(cleanup);

describe('ListCreateForm refuses a list too large to verify, before compose', () => {
    it('names the limit, how many addresses fit and how many were pasted', async () => {
        mount();
        await paste(addresses(300));
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));

        expect(await screen.findByText(/This list has 300 addresses \(12,912 bytes\), but one action holds 8,192 bytes, which fits 190 of them\. Remove 110 addresses\./)).toBeInTheDocument();
        expect(runConfirm).not.toHaveBeenCalled();
    });

    it('composes a list that fits', async () => {
        mount();
        await paste(addresses(190));
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));

        await waitFor(() => expect(runConfirm).toHaveBeenCalled());
        expect(runConfirm.mock.calls[0][0].actionData.params.ITEM).toHaveLength(190);
    });
});
