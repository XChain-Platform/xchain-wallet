// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An edit of a list is a LIST v1 with the added items as its repeating tail.
// Past 8192 compiled bytes it rides a Taproot envelope the wallet cannot
// verify, so the edit screen refuses before review, naming the limit.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import bitcoin from 'bitcoinjs-lib';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';
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
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const address = (i) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i + 1).padStart(40, '0'), 'hex'),
    network: bitcoin.networks.bitcoin,
}).address;
const addresses = (n, from = 0) => Array.from({ length: n }, (_, i) => address(from + i));

function mount(currentItems) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getListByActionIndex: vi.fn().mockResolvedValue({ type: '2', status: 'valid', list: currentItems }),
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
            <ListForkForm
                walletId="wallet-1"
                listRef={{ chainId: BTC, actionIndex: '77', type: '2', items: currentItems }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function addAndReview(list) {
    await screen.findByLabelText(/^Add addresses/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.change(screen.getByLabelText(/^Add addresses/), { target: { value: list.join('\n') } });
    fireEvent.submit(screen.getByLabelText(/^Add addresses/).closest('form'));
}

beforeEach(() => {
    __clearTokenInfoCache();
    runConfirm.mockReset();
    runConfirm.mockRejectedValue(new Error('stop after compose assertion'));
});

afterEach(cleanup);

describe('ListForkForm refuses an edit too large to verify, before review', () => {
    it('names the limit, how many items fit and how many were added', async () => {
        const messaging = mount(addresses(2));
        await addAndReview(addresses(300, 100));

        expect(await screen.findByText('This change has 300 items (12,915 bytes), but one action holds 8,192 bytes, which fits 190 of them. Remove 110 items.')).toBeInTheDocument();
        expect(messaging.getListByActionIndex).toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/Review list edit/);
    });

    it('reviews an edit that fits', async () => {
        mount(addresses(2));
        await addAndReview(addresses(50, 100));
        await waitFor(() => expect(document.body.textContent).toMatch(/Review list edit/));
    });
});
