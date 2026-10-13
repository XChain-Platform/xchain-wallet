// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Drives the bridge move flow, including every unhappy path, because a bridge
// leg is the one authoring surface in this wallet whose mistake cannot be
// undone: an applied credit lands on a chain this screen cannot see and no
// later action redirects it. Each case asserts the sentence the user actually
// reads, not that a boolean flipped.
//
// No JSX: the file is named *bridge*.test.js so the bridge suite can be run on
// its own, and React.createElement reads the same to the renderer.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// The pickers are whole screens of their own. Stubbed to the one fact each case
// is about (which chain the picker was opened on), so this stays about the move
// form's decisions rather than AddressList's rendering.
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, chainId, onPick }) => React.createElement(
        'div',
        null,
        React.createElement('h1', null, title),
        React.createElement('span', { 'data-testid': 'picker-chain' }, chainId),
        React.createElement(
            'button',
            { type: 'button', onClick: () => onPick({ id: 'picked', address: 'PICKED_ADDRESS' }) },
            'pick other',
        ),
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    BridgeMoveForm,
    BridgePendingPanel,
} from '../../../packages/core/src/shared/routes/BridgeMoveForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const BTC_ADDRESS = {
    id: 'a-btc', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
};
const DOGE_ADDRESS = {
    id: 'a-doge', address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
};
const LTC_ADDRESS = {
    id: 'a-ltc', address: 'ltc1qexampleexampleexampleexampleexample', publicKey: '02cc', derivationPath: "m/84'/2'/0'/0/0", source: 'hd',
};

const WAIT = { timeout: 4000 };

/**
 * @param {object} [opts]
 * @param {Record<string, any[]>} [opts.byChain]
 * @param {Record<string, string>} [opts.balances]  tick -> whole-unit amount on the source address
 * @param {any} [opts.feeQuote]
 * @param {any} [opts.tokenInfo]
 * @param {string} [opts.initialTick]
 */
function mount(opts = {}) {
    const byChain = opts.byChain || { [BTC]: [BTC_ADDRESS], [DOGE]: [DOGE_ADDRESS] };
    const balanceTick = opts.balances || { XCHAIN: '10' };
    const walletBalances = {};
    for (const [chainId, addrs] of Object.entries(byChain)) {
        walletBalances[chainId] = addrs.map((a) => ({
            address: a.address,
            balances: {
                tokens: Object.entries(balanceTick).map(([tick, whole]) => ({
                    tick,
                    quantity: Math.round(Number(whole) * 1e8),
                    divisibility: 8,
                })),
            },
        }));
    }
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockImplementation((_w, chainId) => Promise.resolve(
            (byChain[chainId] || [])[0] || null,
        )),
        getWalletBalances: vi.fn().mockResolvedValue(walletBalances),
        getTokenInfo: vi.fn().mockResolvedValue(opts.tokenInfo ?? null),
        requoteNativeFee: vi.fn().mockResolvedValue(opts.feeQuote ?? null),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            chainId: BTC,
            actionString: `XBRIDGE|0|DOGE|${DOGE_ADDRESS.address}|1`,
            version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
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
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(BridgeMoveForm, {
            walletId: 'w',
            initialTick: opts.initialTick,
            onBack() {},
        }),
    ));
    return messaging;
}

const amountInput = () => screen.getByLabelText(/^Amount/i);
// The submit button, named exactly: ChainPicker's own trigger carries the
// accessible name "Move from: Bitcoin" / "Move to: Dogecoin", so a loose /^Move/
// matches three controls.
const moveButton = (name = 'Review move') => screen.getByRole('button', { name });

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

describe('BridgeMoveForm: the destination is resolved from the user\'s own account', () => {
    it('fills the receiving address from the wallet\'s own address on the destination chain', async () => {
        const messaging = mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        expect(messaging.getNewestAddress).toHaveBeenCalledWith('w', DOGE, undefined);
    });

    it('never offers a free-text destination: the field is read-only and changed only by picking another OWN address', async () => {
        mount();
        const field = await waitFor(() => screen.getByLabelText('Receive at'), WAIT);
        expect(field).toHaveAttribute('readonly');

        fireEvent.click(screen.getByRole('button', { name: 'Choose receiving address' }));
        expect(await screen.findByText('Receive at')).toBeInTheDocument();
        // The picker is opened on the DESTINATION chain: an address from the
        // source chain is not spendable at the far end.
        expect(screen.getByTestId('picker-chain').textContent).toBe(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'pick other' }));
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue('PICKED_ADDRESS'),
            WAIT,
        );
    });

    it('states the direction and that the credit cannot be undone or redirected', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByText(/This locks XCHAIN on Bitcoin and credits it on Dogecoin/i))
                .toBeInTheDocument(),
            WAIT,
        );
        expect(screen.getByText(/cannot be undone or redirected/i)).toBeInTheDocument();
        const route = screen.getByLabelText('Bridge route');
        expect(route.textContent).toContain('Source chainBitcoin');
        expect(route.textContent).toContain('Destination chainDogecoin');
        expect(route.textContent).toContain(
            'Expected arrivalAfter the source transaction reaches its required confirmation depth on Bitcoin and validators sign the transfer.',
        );
    });

    it('opens review with the exact bridge parameters instead of implying the button signs immediately', async () => {
        const messaging = mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.click(moveButton());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1), WAIT);
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData).toEqual({
            action: 'XBRIDGE',
            params: {
                VERSION: '0',
                DEST_COIN: 'DOGE',
                DEST_ADDRESS: DOGE_ADDRESS.address,
                AMOUNT: '1',
            },
        });
    });
});

describe('BridgeMoveForm: unhappy path - no destination account', () => {
    it('refuses to offer a destination and says how to create one', async () => {
        mount({ byChain: { [BTC]: [BTC_ADDRESS] } });
        const msg = await screen.findByText(/You have no address on another mainnet chain yet/i, {}, WAIT);
        expect(msg.textContent).toContain('Use Receive to create one first');
        expect(msg.textContent).toContain('cannot be redirected once it applies');
        expect(screen.queryByLabelText('Receive at')).toBeNull();
        expect(moveButton()).toBeDisabled();
    });

    it('does not treat an empty address group as a usable destination', async () => {
        mount({ byChain: { [BTC]: [BTC_ADDRESS], [DOGE]: [] } });
        expect(await screen.findByText(/You have no address on another mainnet chain yet/i, {}, WAIT))
            .toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Move to:/ })).toBeNull();
        expect(moveButton()).toBeDisabled();
    });
});

describe('BridgeMoveForm: unhappy path - a chain the token cannot bridge to', () => {
    it('refuses a destination the issuer never opted in to, and names the ones they did', async () => {
        mount({
            byChain: { [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] },
            initialTick: 'FUFU',
            balances: { FUFU: '100' },
            tokenInfo: { chainId: DOGE, tick: 'FUFU', bridgeChains: 'LTC' },
        });
        const msg = await screen.findByText(/has not opened it to Bitcoin/i, {}, WAIT);
        expect(msg.textContent).toContain('It can be moved to: Litecoin');
        expect(moveButton()).toBeDisabled();
    });

    it('offers only the origin chain for a bridged copy, so a burn cannot be aimed anywhere else', async () => {
        mount({
            byChain: { [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS], [LTC]: [LTC_ADDRESS] },
            initialTick: 'BTC.PEPECASH',
            balances: { 'BTC.PEPECASH': '50' },
        });
        await waitFor(
            () => expect(screen.getByText(/PEPECASH here is a bridged copy of a Bitcoin asset/i))
                .toBeInTheDocument(),
            WAIT,
        );
        // ChainPicker is a popover, not a <select>: open it and read the options.
        fireEvent.click(screen.getByRole('button', { name: /^Move to:/ }));
        const offered = (await screen.findAllByRole('option', {}, WAIT))
            .map((el) => el.textContent);
        expect(offered).toHaveLength(1);
        expect(offered[0]).toContain('Bitcoin');
        expect(offered.join(' ')).not.toContain('Litecoin');
        // And the button says what the leg really is.
        expect(moveButton('Review move back')).toBeInTheDocument();
    });

    it('explains when the wallet has another chain but no address on the only supported destination', async () => {
        mount({
            byChain: { [DOGE]: [DOGE_ADDRESS], [LTC]: [LTC_ADDRESS] },
            initialTick: 'BTC.PEPECASH',
            balances: { 'BTC.PEPECASH': '50' },
        });
        const msg = await screen.findByText(/This bridge route is unavailable/i, {}, WAIT);
        expect(msg.textContent).toContain('PEPECASH on Dogecoin can only move to Bitcoin');
        expect(msg.textContent).toContain('Use Receive on Bitcoin to create one first');
        expect(screen.queryByRole('button', { name: /^Move to:/ })).toBeNull();
        expect(moveButton('Review move back')).toBeDisabled();
    });
});

describe('BridgeMoveForm: unhappy path - amount below the protocol fee', () => {
    it('warns with the REAL quoted fee, and quotes the bytes it is about to send', async () => {
        const messaging = mount({ feeQuote: { supported: true, xchainFee: '0.05000000' } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '0.01' } });

        const warning = await screen.findByText(/costs 0.05 XCHAIN in protocol fees/i, {}, WAIT);
        expect(warning.textContent).toContain('Moving 0.01 XCHAIN');
        expect(warning.textContent).toContain('more than the amount you are moving');
        expect(screen.getByText(/This action's protocol fee is 0.05 XCHAIN/i)).toBeInTheDocument();

        // The fee is quoted for the exact action string, not read off a constant.
        const call = messaging.requoteNativeFee.mock.calls.at(-1)[0];
        expect(call.chainId).toBe(BTC);
        expect(call.source).toBe(BTC_ADDRESS.address);
        expect(call.actionString).toBe(`XBRIDGE|0|DOGE|${DOGE_ADDRESS.address}|0.01`);
    });

    it('is a warning and not a refusal: D13 ruled there is no dust floor, so the move stays available', async () => {
        mount({ feeQuote: { supported: true, xchainFee: '0.05000000' } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '0.01' } });
        await screen.findByText(/costs 0.05 XCHAIN in protocol fees/i, {}, WAIT);
        expect(moveButton()).not.toBeDisabled();
    });

    it('says nothing when the venue will not quote a fee, rather than guessing one', async () => {
        mount({ feeQuote: { supported: false } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '0.01' } });
        await new Promise((r) => { setTimeout(r, 700); });
        expect(screen.queryByText(/in protocol fees/i)).toBeNull();
    });

    it('discloses the quoted protocol fee even when it is less than the amount', async () => {
        mount({ feeQuote: { supported: true, xchainFee: '0.05000000' } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        expect(await screen.findByText(/protocol fee is 0.05 XCHAIN/i, {}, WAIT))
            .toBeInTheDocument();
        expect(screen.queryByText(/more than the amount you are moving/i)).toBeNull();
    });
});

describe('BridgePendingPanel', () => {
    it('shows the submitted transfer as pending with its route and expected arrival condition', () => {
        render(React.createElement(BridgePendingPanel, {
            txid: 'source-txid',
            leg: { leg: 'lock' },
            amount: '12.5',
            tickLabel: 'XCHAIN',
            sourceLabel: 'Bitcoin',
            destLabel: 'Dogecoin',
            destAddress: DOGE_ADDRESS.address,
            minDepth: 8,
            onDone() {},
        }));

        expect(screen.getByRole('status')).toHaveTextContent('Bridge transfer pending');
        expect(screen.getByText('Bitcoin', { selector: 'dd' })).toBeInTheDocument();
        expect(screen.getByText('Dogecoin', { selector: 'dd' })).toBeInTheDocument();
        expect(screen.getByText(/Lock broadcast on Bitcoin; pending on Dogecoin/)).toBeInTheDocument();
        expect(screen.getByText(/This token requires at least 8 confirmations/)).toBeInTheDocument();
    });
});

describe('BridgeMoveForm: unhappy path - amount above balance', () => {
    it('refuses and names what the address actually holds', async () => {
        mount({ balances: { XCHAIN: '10' } });
        await waitFor(
            () => expect(screen.getByText(/10 XCHAIN available/i)).toBeInTheDocument(),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '11' } });
        const msg = await screen.findByText(/You hold 10 XCHAIN on Bitcoin/i, {}, WAIT);
        expect(msg.textContent).toContain('cannot be partly funded');
        expect(moveButton()).toBeDisabled();
    });

    it('allows exactly the balance', async () => {
        mount({ balances: { XCHAIN: '10' } });
        await waitFor(
            () => expect(screen.getByText(/10 XCHAIN available/i)).toBeInTheDocument(),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '10' } });
        await waitFor(() => expect(screen.queryByText(/You hold 10 XCHAIN on Bitcoin/i)).toBeNull(), WAIT);
        expect(moveButton()).not.toBeDisabled();
    });
});

describe('BridgeMoveForm: invalid action fields', () => {
    it('blocks zero and incomplete decimal amounts before confirmation', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '0' } });
        expect(await screen.findByText('Enter a positive amount to move.')).toBeInTheDocument();
        expect(moveButton()).toBeDisabled();

        fireEvent.change(amountInput(), { target: { value: '.' } });
        expect(screen.getByText('Enter a positive amount to move.')).toBeInTheDocument();
        expect(moveButton()).toBeDisabled();
    });

    it('blocks XCHAIN amounts beyond its on-chain decimal precision', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '0.123456789' } });
        expect(await screen.findByText('Amount can have at most 8 decimal places.'))
            .toBeInTheDocument();
        expect(moveButton()).toBeDisabled();
    });

    it('blocks memo delimiters that cannot be serialized', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'left|right' } });
        expect(await screen.findByText('Memo cannot contain "|" or ";".')).toBeInTheDocument();
        expect(moveButton()).toBeDisabled();
    });
});
