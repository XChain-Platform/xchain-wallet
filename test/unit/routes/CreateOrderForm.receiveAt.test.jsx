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

const state = vi.hoisted(() => ({
    messaging: {},
    submit: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: state.messaging, shell: 'web' }),
    screenVariantFor: () => 'web',
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: false }),
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
    useConfirmAction: () => ({ phase: 'idle', composing: false, confirm: state.confirm }),
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
import { pickOrderAsset } from '../../helpers/orderAssetPicker.js';

async function fillQuickOrder() {
    await pickOrderAsset('give', 'xcp');
    fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText(/^Get amount/), { target: { value: '0.1' } });
}

// The composed ORDER params of the last confirm.
async function composedParams() {
    await waitFor(() => expect(state.confirm).toHaveBeenCalled());
    await state.confirm.mock.calls[0][0].compose();
    return state.messaging.composeForConfirm.mock.calls[0][0].actionData.params;
}

beforeEach(() => {
    state.submit.mockReset().mockResolvedValue({ txid: 'tx-1' });
    state.confirm.mockReset().mockResolvedValue({ txid: 'tx-1' });
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
        composeForConfirm: vi.fn(async () => ({ actionString: 'ORDER|0', psbtHex: 'cafe' })),
        preflight: vi.fn(async () => ({ findings: [] })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live', spent: [] })),
        releaseEncoderInputs: vi.fn(async () => {}),
        reserve: vi.fn(async () => ({ id: 'reservation-1' })),
        releaseReservation: vi.fn(async () => {}),
        requoteNativeFee: vi.fn(async () => ({ status: 'ok' })),
        getSignerStatus: vi.fn(async () => ({ status: 'unlocked' })),
    };
    localStorage.clear();
});

afterEach(() => cleanup());

describe('CreateOrderForm Receive at field', () => {
    it('sits right after You get, labelled Receive at, and defaults to the From address', async () => {
        render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />);
        const field = await screen.findByLabelText('Receive at');
        expect(field).toHaveValue('mSourceAddress');
        const get = screen.getByText('You get');
        // Receive at follows the You get card in document order.
        expect(get.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // A standard address field: its trailing icon opens the address picker.
        expect(screen.getByRole('button', { name: 'Choose receive address' })).toBeInTheDocument();
    });

    it('submits a custom receive address as GET_ADDRESS', async () => {
        render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />);
        await fillQuickOrder();
        fireEvent.change(await screen.findByLabelText('Receive at'), { target: { value: '1devmockabc' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect((await composedParams()).GET_ADDRESS).toBe('1devmockabc');
    });

    it('falls back to From when the field is left default or cleared', async () => {
        render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />);
        await fillQuickOrder();
        fireEvent.change(await screen.findByLabelText('Receive at'), { target: { value: '1devmockabc' } });
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: '' } });
        expect(screen.getByLabelText('Receive at')).toHaveValue('');
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await composedParams()).not.toHaveProperty('GET_ADDRESS');
    });

    it('shows the field error for an invalid receive address and sends nothing', async () => {
        render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />);
        await fillQuickOrder();
        fireEvent.change(await screen.findByLabelText('Receive at'), { target: { value: 'bad|address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        await waitFor(() => expect(screen.getAllByText('This is not a valid address.').length).toBeGreaterThan(1));
        expect(screen.getByLabelText('Receive at')).toHaveAttribute('aria-invalid', 'true');
        expect(state.confirm).not.toHaveBeenCalled();
    });
});
