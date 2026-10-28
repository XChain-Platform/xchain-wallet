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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
    watcher: false,
    messaging: {},
    submit: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: state.messaging, shell: 'web' }),
    screenVariantFor: () => 'web',
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: state.watcher }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useActionForm.js', () => ({
    useActionForm: () => {
        const fromAddress = {
            id: 'address-1',
            address: 'mSourceAddress',
            publicKey: '02abcd',
            derivationPath: "m/84'/1'/0'/0/0",
            signerId: 'signer-1',
            source: 'hd',
        };
        return {
            addressesByChain: { 'bitcoin-regtest': [fromAddress] },
            loadError: null,
            chainId: 'bitcoin-regtest',
            setChainId: vi.fn(),
            chainsWithAddresses: ['bitcoin-regtest'],
            fromAddress,
            setFromAddressId: vi.fn(),
            descriptor: {
                id: 'bitcoin-regtest',
                coin: 'bitcoin',
                displayName: 'Bitcoin Regtest',
                networkKind: 'regtest',
                ticker: 'BTC',
            },
            signerReady: true,
            isHwSource: false,
            hwStatus: 'available',
            onHwStatusChange: vi.fn(),
            buildFrom: () => fromAddress,
            submit: state.submit,
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { preflightPrivacy: 'report' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', () => ({
    useConfirmAction: () => ({
        phase: 'idle',
        composing: false,
        confirm: state.confirm,
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerInfo.js', () => ({
    useSignerInfo: () => null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({
        flag: undefined,
        mandatory: false,
        toggleProps: { checked: false, onChange: vi.fn(), mandatory: false },
    }),
}));

import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';

async function renderForm() {
    render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />);
    await screen.findByDisplayValue('mSourceAddress');
}

function chooseTokenOnGetSide() {
    fireEvent.click(screen.getAllByRole('radio', { name: 'A token' })[1]);
}

beforeEach(() => {
    state.watcher = false;
    state.submit.mockReset().mockResolvedValue({ txid: 'tx-123' });
    state.confirm.mockReset();
    state.messaging = {
        getSettings: vi.fn(async () => ({ preflightPrivacy: 'report' })),
        getAutopayExposure: vi.fn(async () => ({ total: 0 })),
        getTokenInfo: vi.fn(async () => ({ divisibility: 1 })),
        getWalletBalances: vi.fn(async () => ({
            'bitcoin-regtest': [{
                address: 'mSourceAddress',
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'XCP', quantity: '1000', divisibility: 1 }],
                },
            }],
        })),
        getSignerStatus: vi.fn(async () => ({ status: 'unlocked' })),
    };
    localStorage.clear();
});

afterEach(() => cleanup());

// Consensus reads 00012 as 12 and 0005.50 as 5.5, so the order goes out in
// that plain spelling, the one the confirm describes, as Place order does.
describe('CreateOrderForm amount text', () => {
    it.each([
        ['00012', '0005.50', '12', '5.5'],
        ['012.0', '0.10', '12', '0.1'],
        ['7', '0.00000001', '7', '0.00000001'],
    ])('composes give %s and get %s as %s and %s', async (give, get, giveWire, getWire) => {
        state.messaging.composeForConfirm = vi.fn(async () => ({ actionString: 'ORDER|0', psbtHex: 'cafe' }));
        state.confirm.mockImplementation(async (args) => { await args.compose(); return { txid: 'tx-1' }; });
        await renderForm();
        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'XCP' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: give } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: get } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

        await waitFor(() => expect(state.messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const { params } = state.messaging.composeForConfirm.mock.calls[0][0].actionData;
        expect(params.GIVE_AMOUNT).toBe(giveWire);
        expect(params.GET_AMOUNT).toBe(getWire);
    });

    it('reads trailing zeros past the token decimals as the plain amount', async () => {
        state.messaging.composeForConfirm = vi.fn(async () => ({ actionString: 'ORDER|0', psbtHex: 'cafe' }));
        state.confirm.mockImplementation(async (args) => { await args.compose(); return { txid: 'tx-1' }; });
        await renderForm();
        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'XCP' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2.50' } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

        await waitFor(() => expect(state.messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(state.messaging.composeForConfirm.mock.calls[0][0].actionData.params.GIVE_AMOUNT).toBe('2.5');
    });
});
