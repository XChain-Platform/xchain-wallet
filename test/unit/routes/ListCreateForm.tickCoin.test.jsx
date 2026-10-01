// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
const DOGE = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const DOGE_ADDRESS = { ...ADDRESS, id: 'doge-source', address: 'DP7exampleDogecoinAddress' };

function mount(supported, { tokenInfo } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [ADDRESS],
            [DOGE]: [DOGE_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(supported),
        getTokenInfo: vi.fn().mockResolvedValue(tokenInfo === undefined ? {
            creator: 'bc1qcreator', totalSupply: '1', canonicalTick: 'PEPE',
        } : tokenInfo),
        getWalletBalances: vi.fn().mockResolvedValue({
            [DOGE]: [{
                address: DOGE_ADDRESS.address,
                balances: {
                    native: { tick: 'DOGE', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'PEPE', quantity: '1', divisibility: 0 }],
                },
            }],
        }),
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
            <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => {
    __clearTokenInfoCache();
    runConfirm.mockReset();
    runConfirm.mockRejectedValue(new Error('stop after compose assertion'));
});

afterEach(cleanup);

describe('ListCreateForm coin-qualified ticker items', () => {
    it('keeps legacy parsing and looks up a qualified-looking ticker on the list chain when support is false', async () => {
        const messaging = mount(false);
        const textarea = await screen.findByLabelText('Tokens (one per line)');
        await waitFor(() => expect(messaging.isListTickCoinActive).toHaveBeenCalledTimes(1));

        fireEvent.change(textarea, { target: { value: 'DOGE:PEPE' } });

        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledWith({
            chainId: BTC,
            tick: 'DOGE:PEPE',
        }));
        expect(screen.queryByLabelText('Coin for DOGE:PEPE')).not.toBeInTheDocument();
    });

    it('rewrites an item for its selected coin, composes it as written, and restores bare own-coin form', async () => {
        const messaging = mount(true, {
            tokenInfo: { creator: null, totalSupply: null, canonicalTick: null },
        });
        const textarea = await screen.findByLabelText('Tokens (one per line)');
        await waitFor(() => expect(messaging.isListTickCoinActive).toHaveBeenCalledTimes(1));

        fireEvent.change(textarea, { target: { value: 'PEPE' } });
        const coin = await screen.findByLabelText('Coin for PEPE');
        expect(coin).toHaveValue('BTC');

        fireEvent.change(coin, { target: { value: 'DOGE' } });
        expect(textarea).toHaveValue('DOGE:PEPE');
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledWith({
            chainId: DOGE,
            tick: 'PEPE',
        }));
        expect(await screen.findByText(/Not found on Dogecoin: PEPE\./)).toBeInTheDocument();

        await screen.findByLabelText('From');
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
        await waitFor(() => expect(runConfirm).toHaveBeenCalled());
        expect(runConfirm.mock.calls[0][0].actionData.params.ITEM).toEqual(['DOGE:PEPE']);

        fireEvent.change(screen.getByLabelText('Coin for PEPE'), { target: { value: 'BTC' } });
        expect(textarea).toHaveValue('PEPE');
    });

    it('adds a token-picker selection under the selected token chain', async () => {
        const messaging = mount(true);
        await screen.findByLabelText('Tokens (one per line)');
        await waitFor(() => expect(messaging.isListTickCoinActive).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: 'Add from token picker' }));
        fireEvent.click(await screen.findByLabelText('Open PEPE details'));

        expect(await screen.findByLabelText('Tokens (one per line)')).toHaveValue('DOGE:PEPE');
    });
});
