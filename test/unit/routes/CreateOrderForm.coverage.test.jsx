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
import {
    openOrderSection, pickOrderAsset, pickOrderCoin, showFullOrderView,
} from '../../helpers/orderAssetPicker.js';

// Gives XCP and gets BTC through the Asset picker, in Quick or in Full.
async function fillBasicOrder({ full = false } = {}) {
    await pickOrderAsset('give', 'xcp', { full });
    if (full) {
        fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '2.5' } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.1' } });
        return;
    }
    fireEvent.change(await screen.findByLabelText(/^Give amount/), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText(/^Get amount/), { target: { value: '0.1' } });
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

describe('CreateOrderForm coverage', () => {
    it('names each side once: the Order section holds one group per side, captioned You give and You get', async () => {
        showFullOrderView();
        await renderForm();

        expect(screen.getAllByText('You give')).toHaveLength(1);
        expect(screen.getAllByText('You get')).toHaveLength(1);
        const give = screen.getByRole('group', { name: 'You give' });
        const get = screen.getByRole('group', { name: 'You get' });
        // Each side is an Asset picker and an Amount, not a coin-or-token radio pair.
        expect(within(give).getByRole('button', { name: /^Asset:/ })).toBeInTheDocument();
        expect(within(give).getByLabelText('Amount')).toBeInTheDocument();
        expect(within(get).getByRole('button', { name: /^Asset:/ })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Asset type' })).toBeNull();
        expect(screen.queryByRole('radio', { name: 'A token' })).toBeNull();
    });

    it('exposes the ownership and auto-pay controls through their native semantic roles', async () => {
        showFullOrderView();
        await renderForm();

        expect(screen.getByRole('switch', {
            name: 'Trade ownership of the give token (not a balance)',
        })).toBeInTheDocument();

        await pickOrderCoin('give', 'Bitcoin', { full: true });

        // Ownership is a token-side choice, so a coin side carries no switch.
        expect(screen.queryByRole('switch', { name: /^Trade ownership of the give/ })).toBeNull();
        openOrderSection('Order Terms');
        expect(screen.getByRole('switch', { name: 'Enable auto-pay' })).toBeChecked();
        // The keep-open fact is a confirm-screen notice, never a form gate.
        expect(screen.queryByRole('checkbox', { name: /I understand/ })).toBeNull();
    });

    it('keeps the receive address with the get side and the expiration in Order Terms', async () => {
        showFullOrderView();
        await renderForm();

        const sectionOf = (el) => el.closest('[data-form-section]')?.getAttribute('data-form-section');
        expect(sectionOf(screen.getByLabelText('Receive at'))).toBe('order');
        openOrderSection('Order Terms');
        expect(sectionOf(screen.getByRole('group', { name: 'Expiration' }))).toBe('options');
        expect(screen.queryByRole('heading', { name: 'Expiration' })).toBeNull();
        // The same-network note lives in the From address help tip, not as a line under Network,
        // and the Network field carries its own help tip.
        expect(screen.queryByText(/Both sides of this order settle on the same chain/)).toBeNull();
        openOrderSection('From');
        expect(screen.getByRole('button', { name: 'About Network' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'About From address' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Both sides of the order settle on this network');
    });

    it('surfaces actionable validation for malformed order fields', async () => {
        showFullOrderView();
        await renderForm();

        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByText('Enter the ticker to give.')).toBeInTheDocument();

        await fillBasicOrder({ full: true });
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: 'bad|address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByText('This is not a valid address.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: '' } });
        openOrderSection('Order Terms');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'bad;memo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByText('Memo cannot contain "|" or ";".')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Expire at a specific time' }));
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByText('Pick an expiration date and time, or switch to the default window.'))
            .toBeInTheDocument();
    });

    it('rejects malformed ticker IDs, excess precision, and give amounts above balance before review', async () => {
        showFullOrderView();
        await renderForm();

        await pickOrderAsset('give', '^bad', { full: true });
        fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '2.5' } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Give ticker can be a name, or ^ followed by the token's number (^123).",
        );

        await pickOrderAsset('give', 'XCP', { full: true });
        fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '2.55' } });
        await waitFor(() => expect(state.messaging.getTokenInfo).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        // The amount field shows its own decimal-places error beside the form's.
        await waitFor(() => expect(screen.getAllByRole('alert')
            .some((a) => /at most 1 decimal place/.test(a.textContent))).toBe(true));

        fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '100.1' } });
        await waitFor(() => expect(state.messaging.getWalletBalances).toHaveBeenCalled());
        expect(await screen.findByText(/XCP available/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Give amount exceeds your available XCP balance of 100.',
        );
        expect(state.confirm).not.toHaveBeenCalled();
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
        await fillBasicOrder();

        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));

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

        fireEvent.click(screen.getByRole('button', { name: 'My Orders' }));
        expect(onManageOrders).toHaveBeenCalledOnce();
    });

    it('previews and builds an unsigned order in watcher mode', async () => {
        state.watcher = true;
        state.submit.mockResolvedValue({ psbtHex: 'deadbeef' });
        showFullOrderView();
        await renderForm();
        await fillBasicOrder({ full: true });
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: '1devmockabc' } });

        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByText('Review Order')).toBeInTheDocument();
        expect(screen.getByText(/prepares the transaction for your offline signer/)).toBeInTheDocument();
        expect(screen.getByTestId('action-intent')).toHaveTextContent('2.5 XCP');
        expect(screen.getByTestId('action-intent')).toHaveTextContent('0.1 BTC');
        expect(screen.getByTestId('action-intent')).toHaveTextContent('1devmockabc');
        expect(screen.getByText('Settlement address')).toBeInTheDocument();
        expect(screen.getByText('Default window')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getAllByRole('button', { name: /^Asset:/ })[0]).toHaveAccessibleName(/^Asset: XCP/);
        expect(screen.getAllByLabelText('Amount')[0]).toHaveValue('2.5');
        // Back from review the coin amount shows padded to 8 decimals (U61).
        expect(screen.getByLabelText('Amount (BTC)')).toHaveValue('0.10000000');
        expect(screen.getByLabelText('Receive at')).toHaveValue('1devmockabc');
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));

        fireEvent.click(screen.getByRole('button', { name: 'Create Unsigned Transaction' }));
        await waitFor(() => expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
            params: expect.objectContaining({ GIVE_TICK: 'XCP', GET_AMOUNT: '0.1' }),
            password: '',
        })));
        expect(await screen.findByText('Unsigned transaction, ready for signing'))
            .toBeInTheDocument();
    });

    it('shows plain copy for watcher encoder failures and keeps the review values', async () => {
        state.watcher = true;
        state.submit.mockRejectedValue(new Error('orderAction: encoder POST /internal/order failed'));
        await renderForm();
        await fillBasicOrder();

        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create Unsigned Transaction' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not create the order. Check the details and try again.',
        );
        expect(document.body).not.toHaveTextContent('/internal/order');
        expect(screen.getByTestId('action-intent')).toHaveTextContent('2.5 XCP');
    });

    it.each([
        ['over 250 characters', `${'😀'.repeat(125)}a`, /251 characters; the network accepts at most 250 characters/],
        // The shared action-text refusal answers first, before the memo's own check.
        ['a bidirectional override', 'pay \u202etxt.exe', /Memo cannot contain text-direction control characters/],
        ['a tab', 'a\tb', /Memo cannot contain control characters/],
    ])('refuses a memo %s before composing', async (_label, memo, message) => {
        await renderForm();
        await fillBasicOrder();
        openOrderSection('Order Terms');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: memo } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(state.confirm).not.toHaveBeenCalled();
    });

    it('accepts a memo of exactly 250 bytes', async () => {
        await renderForm();
        await fillBasicOrder();
        openOrderSection('Order Terms');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'x'.repeat(250) } });
        fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));
        await waitFor(() => expect(state.messaging.composeForConfirm.mock.calls.length + state.confirm.mock.calls.length + state.submit.mock.calls.length).toBeGreaterThan(0));
    });
});
