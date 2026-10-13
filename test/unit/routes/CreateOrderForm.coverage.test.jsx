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

function fillBasicOrder() {
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'xcp' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.1' } });
}

async function renderForm(props = {}) {
    render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} {...props} />);
    await screen.findByDisplayValue('mSourceAddress');
}

beforeEach(() => {
    state.watcher = false;
    state.submit.mockReset().mockResolvedValue({ txid: 'tx-123' });
    state.confirm.mockReset();
    state.messaging = {
        getSettings: vi.fn(async () => ({ preflightPrivacy: 'report' })),
        getAutopayExposure: vi.fn(async () => ({ total: 0 })),
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

describe('CreateOrderForm coverage', () => {
    it('surfaces actionable validation for malformed order fields', async () => {
        await renderForm();

        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Enter the ticker you are offering.')).toBeInTheDocument();

        fillBasicOrder();
        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: 'bad|address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Receive address is invalid.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options (lists, memo)' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'bad;memo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Memo cannot contain "|" or ";".')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: '' } });
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Pick an expiration date and time, or switch to the default window.'))
            .toBeInTheDocument();
    });

    it('threads a valid order through confirm composition and software submission', async () => {
        state.confirm.mockImplementation(async (options) => {
            const composed = await options.compose();
            await options.preflight({ actionString: composed.actionString });
            await options.checkInputs(composed.psbtHex);
            await options.reservationLedger.reserve({ amount: '1' });
            await options.reservationLedger.release('reservation-1');
            await options.requoteNativeFee({ actionString: composed.actionString, source: options.source });
            return options.onApprove({}, null);
        });
        const onManageOrders = vi.fn();
        await renderForm({ onManageOrders });
        fillBasicOrder();

        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

        expect(await screen.findByText('Order broadcast')).toBeInTheDocument();
        expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-regtest',
            source: 'mSourceAddress',
        }));
        expect(state.messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            chainId: 'bitcoin-regtest',
            actionData: {
                action: 'ORDER',
                params: expect.objectContaining({
                    VERSION: '0',
                    GIVE_COIN: 'BTC',
                    GIVE_TICK: 'XCP',
                    GIVE_AMOUNT: '2.5',
                    GET_COIN: 'BTC',
                    GET_TICK: '',
                    GET_AMOUNT: '0.1',
                }),
            },
        }));
        expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
            password: '',
            params: expect.objectContaining({ GIVE_TICK: 'XCP', GET_AMOUNT: '0.1' }),
        }));

        fireEvent.click(screen.getByRole('button', { name: 'My orders' }));
        expect(onManageOrders).toHaveBeenCalledOnce();
    });

    it('previews and builds an unsigned order in watcher mode', async () => {
        state.watcher = true;
        state.submit.mockResolvedValue({ psbtHex: 'deadbeef' });
        await renderForm();
        fillBasicOrder();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText('Review order')).toBeInTheDocument();
        expect(screen.getByText(/Watcher mode:/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
        await waitFor(() => expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
            params: expect.objectContaining({ GIVE_TICK: 'XCP', GET_AMOUNT: '0.1' }),
            password: '',
        })));
        expect(await screen.findByRole('heading', { name: 'Unsigned transaction, ready for signing' }))
            .toBeInTheDocument();
    });
});
