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
    it('names each side once: the section says You give, its radio group says what it picks', async () => {
        await renderForm();

        expect(screen.getAllByText('You give')).toHaveLength(1);
        expect(screen.getAllByText('You get')).toHaveLength(1);
        const give = screen.getByRole('region', { name: 'You give' });
        expect(within(give).getByRole('group', { name: 'Asset type' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'You give' })).toBeNull();
    });

    it('exposes kit choice controls through their native semantic roles', async () => {
        await renderForm();

        const giveToken = screen.getAllByRole('radio', { name: 'A token' })[0];
        expect(giveToken).toHaveAttribute('name', 'You give-type');
        expect(giveToken).toHaveAttribute('value', 'token');
        expect(screen.getByRole('checkbox', {
            name: 'Trade ownership of this ticker (not a balance)',
        })).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('radio', { name: 'Native BTC' })[0]);

        expect(screen.getByRole('switch', { name: 'Enable CoinPay auto-pay' })).toBeChecked();
        expect(screen.getByRole('checkbox', {
            name: 'I understand this web wallet only auto-pays while it is open and unlocked.',
        })).not.toBeChecked();
    });

    it('keeps the receive address with the get side and names the last section for all it holds', async () => {
        await renderForm();

        const getSection = screen.getByRole('region', { name: 'You get' });
        expect(getSection).toContainElement(screen.getByLabelText('Receive at (optional)'));
        const timing = screen.getByRole('region', { name: 'Timing and fees' });
        // The section title no longer repeats the Expiration choice right below it.
        expect(timing).toContainElement(screen.getByRole('group', { name: 'Expiration' }));
        expect(screen.queryByRole('heading', { name: 'Expiration' })).toBeNull();
        // Help text among the fields lines up with them instead of centring.
        expect(screen.getByText(/Both sides of this order settle on the same chain/).className).toMatch(/hintLeft/);
    });

    it('surfaces actionable validation for malformed order fields', async () => {
        await renderForm();

        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Enter the ticker to give.')).toBeInTheDocument();

        fillBasicOrder();
        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: 'bad|address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('This is not a valid address.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options (lists, memo)' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'bad;memo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Memo cannot contain "|" or ";".')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Expire at a specific time' }));
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText('Pick an expiration date and time, or switch to the default window.'))
            .toBeInTheDocument();
    });

    it('rejects malformed ticker IDs, excess precision, and give amounts above balance before review', async () => {
        await renderForm();

        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: '^bad' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2.5' } });
        fireEvent.change(screen.getByLabelText('Amount (BTC)'), { target: { value: '0.1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Give ticker can be a name, or ^ followed by the token's number (^123).",
        );

        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'XCP' } });
        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2.55' } });
        await waitFor(() => expect(state.messaging.getTokenInfo).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Give amount can have at most 1 decimal place for XCP.',
        );

        fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100.1' } });
        await waitFor(() => expect(state.messaging.getWalletBalances).toHaveBeenCalled());
        await act(async () => {});
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
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
        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: '1devmockabc' } });

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText('Review order')).toBeInTheDocument();
        expect(screen.getByText(/Watcher mode:/)).toBeInTheDocument();
        expect(screen.getByTestId('action-intent')).toHaveTextContent('2.5 XCP');
        expect(screen.getByTestId('action-intent')).toHaveTextContent('0.1 BTC');
        expect(screen.getByTestId('action-intent')).toHaveTextContent('1devmockabc');
        expect(screen.getByText('Settlement address')).toBeInTheDocument();
        expect(screen.getByText('Default window')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByLabelText('Ticker')).toHaveValue('XCP');
        expect(screen.getByLabelText('Amount')).toHaveValue('2.5');
        expect(screen.getByLabelText('Amount (BTC)')).toHaveValue('0.1');
        expect(screen.getByLabelText('Receive at (optional)')).toHaveValue('1devmockabc');
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
        await waitFor(() => expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
            params: expect.objectContaining({ GIVE_TICK: 'XCP', GET_AMOUNT: '0.1' }),
            password: '',
        })));
        expect(await screen.findByRole('heading', { name: 'Unsigned transaction, ready for signing' }))
            .toBeInTheDocument();
    });

    it('shows plain copy for watcher encoder failures and keeps the review values', async () => {
        state.watcher = true;
        state.submit.mockRejectedValue(new Error('orderAction: encoder POST /internal/order failed'));
        await renderForm();
        fillBasicOrder();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not create the order. Check the details and try again.',
        );
        expect(document.body).not.toHaveTextContent('/internal/order');
        expect(screen.getByTestId('action-intent')).toHaveTextContent('2.5 XCP');
    });

    it.each([
        ['over 250 bytes', 'x'.repeat(251), /251 bytes; the network accepts at most 250 bytes/],
        // The shared action-text refusal answers first, before the memo's own check.
        ['a bidirectional override', 'pay \u202etxt.exe', /Memo cannot contain text-direction control characters/],
        ['a tab', 'a\tb', /Memo cannot contain control characters/],
    ])('refuses a memo %s before composing', async (_label, memo, message) => {
        await renderForm();
        fillBasicOrder();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options (lists, memo)' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: memo } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(state.confirm).not.toHaveBeenCalled();
    });

    it('accepts a memo of exactly 250 bytes', async () => {
        await renderForm();
        fillBasicOrder();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options (lists, memo)' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'x'.repeat(250) } });
        fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
        await waitFor(() => expect(state.messaging.composeForConfirm.mock.calls.length + state.confirm.mock.calls.length + state.submit.mock.calls.length).toBeGreaterThan(0));
    });
});
