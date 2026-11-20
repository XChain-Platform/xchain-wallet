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
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { useFakeTimeouts } from '../../helpers/fakeTimeouts.js';
import { feeForRate, networkFeeEditor } from '../../helpers/customNetworkFee.js';
import { slowTimeout } from '../../helpers/testEnvSpeed.js';

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

// The fixtures sit on mainnet, where the bridge is not live yet. These cases
// are about the move itself, so the schedule reads as live here; the refusal
// is covered against the real schedule in BridgeMoveForm.pageStates.test.jsx.
vi.mock('../../../packages/core/src/flows/protocolActivations.js', async (importOriginal) => ({
    ...(await importOriginal()),
    xbridgeScheduledHeight: () => 0,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import {
    BridgeMoveForm,
    BridgePendingPanel,
} from '../../../packages/core/src/shared/routes/BridgeMoveForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { __clearFeeScheduleCache } from '../../../packages/core/src/shared/hooks/useFeeSchedule.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const BTC_ADDRESS = {
    id: 'a-btc', address: 'bc1qdevmock02aa', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
};
const DOGE_ADDRESS = {
    id: 'a-doge', address: 'Ddevmock02bb', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
};
const LTC_ADDRESS = {
    id: 'a-ltc', address: 'ltc1qdevmock02cc', publicKey: '02cc', derivationPath: "m/84'/2'/0'/0/0", source: 'hd',
};

// 4 s on a dev box; scaled so coverage instrumentation on a loaded runner does not
// outrun it (the debounced balance read and every async mount settle inside it).
// Loaded CI venues need well over 4 s for the wallet list to fill Receive at.
const WAIT = { timeout: slowTimeout(15000) };

/**
 * @param {object} [opts]
 * @param {Record<string, any[]>} [opts.byChain]
 * @param {Record<string, string>} [opts.balances]  tick -> whole-unit amount on the source address
 * @param {any} [opts.feeQuote]
 * @param {any} [opts.tokenInfo]
 * @param {string} [opts.initialTick]
 * @param {string} [opts.walletMode]
 * @param {Function} [opts.requoteNativeFee]
 * @param {Function} [opts.buildActionPsbtRequest]
 * @param {Function} [opts.getTokenInfo]
 * @param {Function} [opts.getNewestAddress]
 * @param {Function} [opts.composeForConfirm]
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
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode: opts.walletMode || 'full' }], activeWalletId: 'w' });
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: opts.getNewestAddress || vi.fn().mockImplementation((_w, chainId) => Promise.resolve(
            (byChain[chainId] || [])[0] || null,
        )),
        getWalletBalances: vi.fn().mockResolvedValue(walletBalances),
        getTokenInfo: opts.getTokenInfo || vi.fn().mockResolvedValue(opts.tokenInfo ?? null),
        requoteNativeFee: opts.requoteNativeFee || vi.fn().mockResolvedValue(opts.feeQuote ?? null),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: opts.walletMode || 'full' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        composeForConfirm: opts.composeForConfirm || vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            chainId: BTC,
            actionString: `XBRIDGE|0|DOGE|${DOGE_ADDRESS.address}|1`,
            version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        ...(opts.buildActionPsbtRequest ? { buildActionPsbtRequest: opts.buildActionPsbtRequest } : {}),
        ...(opts.getFeeSchedule ? { getFeeSchedule: opts.getFeeSchedule } : {}),
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
const moveButton = (name = 'Move') => screen.getByRole('button', { name });

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
    vi.useRealTimers();
    __clearTokenInfoCache();
    __clearFeeScheduleCache();
});

async function advanceFeeQuote() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
    });
}

describe('BridgeMoveForm: the destination is resolved from the user\'s own account', () => {
    it('fills the receiving address from the wallet\'s own address on the destination network', async () => {
        const messaging = mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        expect(messaging.getNewestAddress).toHaveBeenCalledWith('w', DOGE, undefined);
    });

    it('clears source-scoped input and ignores an old fee quote after the network pair changes', async () => {
        let resolveQuote;
        const quote = new Promise((resolve) => { resolveQuote = resolve; });
        const requoteNativeFee = vi.fn(() => quote);
        const messaging = mount({
            byChain: { [BTC]: [BTC_ADDRESS], [DOGE]: [DOGE_ADDRESS], [LTC]: [LTC_ADDRESS] },
            requoteNativeFee,
        });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        useFakeTimeouts();
        fireEvent.change(amountInput(), { target: { value: '1' } });
        await advanceFeeQuote();
        expect(requoteNativeFee).toHaveBeenCalled();

        // The source network is the Network field of the closed From section.
        fireEvent.click(screen.getByRole('button', { name: /^From\b/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Network: Bitcoin' }));
        fireEvent.click(screen.getByRole('button', { name: /Select Dogecoin/ }));
        expect(amountInput()).toHaveValue('');
        expect(screen.queryByText(/protocol fee is/i)).toBeNull();

        await act(async () => { resolveQuote({ supported: true, xchainFee: '0.5' }); });
        expect(screen.queryByText(/protocol fee is 0.5 XCHAIN/i)).toBeNull();
        vi.useRealTimers();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(BTC_ADDRESS.address),
            WAIT,
        );
        expect(messaging.requoteNativeFee).toHaveBeenCalledTimes(1);
    });

    it('dispatches one watcher build when the move form is submitted twice in one turn', async () => {
        let resolveBuild;
        const build = new Promise((resolve) => { resolveBuild = resolve; });
        const buildActionPsbtRequest = vi.fn(() => build);
        const messaging = mount({ walletMode: 'watcher', buildActionPsbtRequest });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled(), WAIT);
        fireEvent.change(amountInput(), { target: { value: '1' } });
        const form = moveButton().closest('form');
        await act(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);

        await act(async () => { resolveBuild({ psbtHex: 'aa00' }); });
    });

    it('keeps the own-address picker while allowing a receiving address to be typed', async () => {
        mount();
        const field = await waitFor(() => screen.getByLabelText('Receive at'), WAIT);
        expect(field).not.toHaveAttribute('readonly');

        fireEvent.change(field, { target: { value: 'typed destination' } });
        expect(field).toHaveValue('typed destination');

        fireEvent.click(screen.getByRole('button', { name: 'Choose receiving address' }));
        expect(await screen.findByText('Receive At')).toBeInTheDocument();
        // The picker is opened on the DESTINATION chain: an address from the
        // source chain is not spendable at the far end.
        expect(screen.getByTestId('picker-chain').textContent).toBe(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'pick other' }));
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue('PICKED_ADDRESS'),
            WAIT,
        );
    });

    it('does not overwrite a typed address when the asynchronous own-address prefill arrives', async () => {
        let resolveNewest;
        mount({
            getNewestAddress: vi.fn(() => new Promise((resolve) => { resolveNewest = resolve; })),
        });
        const field = await waitFor(() => screen.getByLabelText('Receive at'), WAIT);
        fireEvent.change(field, { target: { value: 'typed destination' } });
        await act(async () => { resolveNewest(DOGE_ADDRESS); });
        expect(field).toHaveValue('typed destination');
    });

    it('validates the receiving address for the destination chain and trims pasted text', async () => {
        const validDogecoin = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
        const bitcoinOnly = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
        mount();
        const field = await waitFor(() => screen.getByLabelText('Receive at'), WAIT);
        fireEvent.change(amountInput(), { target: { value: '10' } });

        fireEvent.change(field, { target: { value: 'not an address' } });
        expect(await screen.findAllByText('This is not a valid address.', {}, WAIT)).not.toHaveLength(0);
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(moveButton()).toBeEnabled();

        fireEvent.change(field, { target: { value: bitcoinOnly } });
        expect(await screen.findAllByText(/Bitcoin mainnet address, not a Dogecoin mainnet address/i, {}, WAIT))
            .not.toHaveLength(0);
        expect(moveButton()).toBeEnabled();

        fireEvent.change(field, { target: { value: '' } });
        fireEvent.paste(field, { clipboardData: { getData: () => `  ${validDogecoin}  ` } });
        expect(field).toHaveValue(validDogecoin);
        await waitFor(() => expect(moveButton()).not.toBeDisabled(), WAIT);
    });

    it('shows one exact route notice on the confirm screen and removes the duplicate network and arrival rows', async () => {
        mount();
        await waitFor(() => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address), WAIT);
        fireEvent.change(amountInput(), { target: { value: '10' } });
        // The form carries no standing notice; the lock-and-credit fact is on the confirm screen.
        expect(screen.queryByText(/Locks 10 XCHAIN on Bitcoin/)).toBeNull();
        fireEvent.click(moveButton());
        expect(await screen.findByText(
            // That it can't be undone is the warnings card's BRIDGE_MOVE line.
            'Locks 10 XCHAIN on Bitcoin and credits it on Dogecoin after 6 confirmations (~60 min).',
            {},
            WAIT,
        )).toBeInTheDocument();
        expect(screen.queryByText('Source network')).toBeNull();
        expect(screen.queryByText('Destination network')).toBeNull();
        expect(screen.queryByText('Expected arrival')).toBeNull();
        expect(screen.queryByLabelText('Bridge route')).toBeNull();
    });

    it('raises the platform depth to the token minimum in the wait estimate', async () => {
        mount({
            initialTick: 'FUFU',
            balances: { FUFU: '10' },
            tokenInfo: { bridgeChains: 'DOGE', minDepth: '8' },
        });
        await waitFor(() => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address), WAIT);
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.click(moveButton());
        expect(await screen.findByText(
            'Locks 1 FUFU on Bitcoin and credits it on Dogecoin after 8 confirmations (~80 min).',
            {},
            WAIT,
        )).toBeInTheDocument();
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

    it('shows values decoded from the composed action and Back keeps the form values', async () => {
        const composeForConfirm = vi.fn(async ({ actionData }) => ({
            psbt: 'aa00',
            encoding: 'psbt',
            chainId: BTC,
            actionString: `XBRIDGE|0|DOGE|${DOGE_ADDRESS.address}|1.25|keep me`,
            version: 1,
            decoded: {
                summary: 'Bridge transfer',
                warnings: [],
                details: [
                    { label: 'Amount', value: actionData.params.AMOUNT },
                    { label: 'Destination', value: actionData.params.DEST_ADDRESS },
                    { label: 'Memo', value: actionData.params.MEMO },
                ],
            },
        }));
        mount({ composeForConfirm });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1.25' } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'keep me' } });
        fireEvent.click(moveButton());

        expect(await screen.findByText('1.25', {}, WAIT)).toBeInTheDocument();
        // The destination is present in full in the facts card (G127).
        expect(screen.getByTestId('confirm-facts').querySelector(`[title="${DOGE_ADDRESS.address}"]`)).not.toBeNull();
        expect(screen.getByText('keep me')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        await waitFor(() => expect(amountInput()).toHaveValue('1.25000000'), WAIT);
        expect(screen.getByLabelText('Memo')).toHaveValue('keep me');
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
    });
});

describe('BridgeMoveForm: unhappy path - no destination account', () => {
    it('refuses to offer a destination and says how to create one', async () => {
        mount({ byChain: { [BTC]: [BTC_ADDRESS] } });
        const msg = await screen.findByText(/You have no address on another network yet/i, {}, WAIT);
        expect(msg.textContent).toContain('Use Receive to create one first');
        expect(msg.textContent).toContain('cannot be redirected once it applies');
        expect(screen.queryByLabelText('Receive at')).toBeNull();
        expect(moveButton()).toBeEnabled();
    });

    it('does not treat an empty address group as a usable destination', async () => {
        mount({ byChain: { [BTC]: [BTC_ADDRESS], [DOGE]: [] } });
        expect(await screen.findByText(/You have no address on another network yet/i, {}, WAIT))
            .toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Move to:/ })).toBeNull();
        expect(moveButton()).toBeEnabled();
    });
});

describe('BridgeMoveForm: unhappy path - a chain the token cannot bridge to', () => {
    it('refuses a destination the issuer never opted in to without repeating network names', async () => {
        mount({
            byChain: { [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] },
            initialTick: 'FUFU',
            balances: { FUFU: '100' },
            tokenInfo: { chainId: DOGE, tick: 'FUFU', bridgeChains: 'LTC' },
        });
        const msg = await screen.findByText(/cannot move to the selected destination network/i, {}, WAIT);
        expect(msg.textContent).not.toMatch(/Bitcoin|Litecoin|mainnet|regtest|testnet|not mainnet/i);
        expect(moveButton()).toBeEnabled();
    });

    it('offers only the origin network for a bridged copy, so a burn cannot be aimed anywhere else', async () => {
        mount({
            byChain: { [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS], [LTC]: [LTC_ADDRESS] },
            initialTick: 'BTC.PEPECASH',
            balances: { 'BTC.PEPECASH': '50' },
        });
        await waitFor(
            () => expect(screen.getByText(/PEPECASH here is a bridged copy of its origin-chain asset/i))
                .toBeInTheDocument(),
            WAIT,
        );
        // NetworkField opens its picker screen, so read the network rows there.
        fireEvent.click(screen.getByRole('button', { name: /^Move to:/ }));
        const offered = (await screen.findAllByRole('button', { name: /^Select / }, WAIT))
            .map((el) => el.textContent);
        expect(offered).toHaveLength(1);
        expect(offered[0]).toContain('Bitcoin');
        expect(offered.join(' ')).not.toContain('Litecoin');
        // And the button says what the leg really is.
        expect(moveButton(/^Move back$/i)).toBeInTheDocument();
    });

    it('explains when the wallet has another network but no address on the only supported destination', async () => {
        mount({
            byChain: { [DOGE]: [DOGE_ADDRESS], [LTC]: [LTC_ADDRESS] },
            initialTick: 'BTC.PEPECASH',
            balances: { 'BTC.PEPECASH': '50' },
        });
        const msg = await screen.findByText(/This bridge route is unavailable/i, {}, WAIT);
        expect(msg.textContent).toContain('no address on the required destination chain');
        expect(msg.textContent).toContain('Use Receive there to create one first');
        expect(msg.textContent).not.toMatch(/Bitcoin|Dogecoin|mainnet|regtest|testnet|not mainnet/i);
        expect(screen.queryByRole('button', { name: /^Move to:/ })).toBeNull();
        expect(moveButton(/^Move back$/i)).toBeEnabled();
    });
});

describe('BridgeMoveForm: unhappy path - amount below the protocol fee', () => {
    it('warns with the REAL quoted fee, and quotes the bytes it is about to send', async () => {
        const messaging = mount({ feeQuote: { supported: true, xchainFee: '0.05000000' } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        useFakeTimeouts();
        fireEvent.change(amountInput(), { target: { value: '0.01' } });
        await advanceFeeQuote();

        const warning = screen.getByText(/costs 0.05 XCHAIN in protocol fees/i);
        expect(warning.textContent).toContain('Moving 0.01 XCHAIN');
        expect(warning.textContent).toContain('more than the amount you are moving');
        // The Fees section's Protocol fee line names the quoted fee.
        expect(document.querySelector('[data-fees-row="protocol"]')).toHaveTextContent('0.05 XCHAIN');

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
        useFakeTimeouts();
        fireEvent.change(amountInput(), { target: { value: '0.01' } });
        await advanceFeeQuote();
        expect(screen.getByText(/costs 0.05 XCHAIN in protocol fees/i)).toBeInTheDocument();
        expect(moveButton()).not.toBeDisabled();
    });

    it('says nothing when the venue will not quote a fee, rather than guessing one', async () => {
        const messaging = mount({ feeQuote: { supported: false } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        useFakeTimeouts();
        fireEvent.change(amountInput(), { target: { value: '0.01' } });
        await advanceFeeQuote();
        expect(screen.queryByText(/in protocol fees/i)).toBeNull();
    });

    it('discloses the quoted protocol fee even when it is less than the amount', async () => {
        mount({ feeQuote: { supported: true, xchainFee: '0.05000000' } });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        useFakeTimeouts();
        fireEvent.change(amountInput(), { target: { value: '1' } });
        await advanceFeeQuote();
        expect(document.querySelector('[data-fees-row="protocol"]')).toHaveTextContent('0.05 XCHAIN');
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
            sourceDescriptor: {
                id: BTC, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet', color: '#f7931a',
            },
            destDescriptor: {
                id: DOGE, coin: 'dogecoin', displayName: 'Dogecoin', networkKind: 'mainnet', color: '#c2a633',
            },
            destAddress: DOGE_ADDRESS.address,
            minDepth: 8,
            onDone() {},
        }));

        expect(screen.getByRole('status')).toHaveTextContent('Bridge transfer pending');
        expect(document.body.querySelectorAll('dd img')).toHaveLength(2);
        expect(document.body.textContent).not.toMatch(/Bitcoin|Dogecoin|mainnet|regtest|testnet|not mainnet/i);
        expect(screen.getByText(/Lock broadcast; destination pending/)).toBeInTheDocument();
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
        const msg = await screen.findByText(/You hold 10 XCHAIN at the source address/i, {}, WAIT);
        expect(msg.textContent).toContain('cannot be partly funded');
        expect(moveButton()).toBeEnabled();
    });

    it('allows exactly the balance', async () => {
        mount({ balances: { XCHAIN: '10' } });
        await waitFor(
            () => expect(screen.getByText(/10 XCHAIN available/i)).toBeInTheDocument(),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '10' } });
        await waitFor(() => expect(screen.queryByText(/You hold 10 XCHAIN at the source address/i)).toBeNull(), WAIT);
        expect(moveButton()).not.toBeDisabled();
    });
});

describe('BridgeMoveForm: invalid action fields', () => {
    it('explains an empty amount before opening review', async () => {
        const messaging = mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.click(moveButton());
        // The list at the top and the field's own line both say it.
        expect(await screen.findAllByText('Enter an amount to move.')).toHaveLength(2);
        expect(screen.getByLabelText(/^Amount/)).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('blocks zero and incomplete decimal amounts before confirmation', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '0' } });
        expect(await screen.findByText('Enter a positive amount to move.')).toBeInTheDocument();
        expect(moveButton()).toBeEnabled();

        fireEvent.change(amountInput(), { target: { value: '.' } });
        expect(screen.getByText('Enter a positive amount to move.')).toBeInTheDocument();
        expect(moveButton()).toBeEnabled();
    });

    it('blocks a negative amount with plain decimal guidance', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '-1' } });
        expect(await screen.findByText(/Enter a valid decimal amount/i)).toBeInTheDocument();
        expect(moveButton()).toBeEnabled();
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
        expect(moveButton()).toBeEnabled();
    });

    it('blocks memo delimiters that cannot be serialized', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'left|right' } });
        expect(await screen.findByText('Memo cannot contain "|" or ";".')).toBeInTheDocument();
        expect(moveButton()).toBeEnabled();
    });

    it('blocks a memo above the on-chain character limit', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: `${'😀'.repeat(125)}aa` } });
        expect(await screen.findByText('Memo is 252 characters; the network accepts at most 250 characters.'))
            .toBeInTheDocument();
        expect(moveButton()).toBeEnabled();
    });

    it('blocks malformed source and destination addresses before compose', async () => {
        const badSource = { ...BTC_ADDRESS, address: 'not-a-bitcoin-address' };
        const messaging = mount({ byChain: { [BTC]: [badSource], [DOGE]: [DOGE_ADDRESS] } });
        expect(await screen.findByText('This is not a valid address.', {}, WAIT))
            .toBeInTheDocument();
        expect(moveButton()).toBeEnabled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        cleanup();
        const badDestination = { ...DOGE_ADDRESS, address: 'not-a-dogecoin-address' };
        const second = mount({ byChain: { [BTC]: [BTC_ADDRESS], [DOGE]: [badDestination] } });
        expect(await screen.findAllByText('This is not a valid address.', {}, WAIT))
            .not.toHaveLength(0);
        expect(moveButton()).toBeEnabled();
        expect(second.composeForConfirm).not.toHaveBeenCalled();

        cleanup();
        const missingId = { ...BTC_ADDRESS, id: '' };
        const third = mount({ byChain: { [BTC]: [missingId], [DOGE]: [DOGE_ADDRESS] } });
        expect(await screen.findByText(/No usable source address is available/i, {}, WAIT))
            .toBeInTheDocument();
        expect(moveButton()).toBeEnabled();
        expect(third.composeForConfirm).not.toHaveBeenCalled();
    });

    it('explains an empty stored destination before review', async () => {
        const emptyDestination = { ...DOGE_ADDRESS, address: '' };
        const messaging = mount({ byChain: { [BTC]: [BTC_ADDRESS], [DOGE]: [emptyDestination] } });
        // An empty Receive at is also what the field shows before the wallet's
        // addresses load, so that alone proves nothing. The balance footer lands
        // after the addresses and the 400 ms balance debounce, so waiting for it
        // proves the form is settled; a press earlier is dropped silently as "no
        // destination account yet" and the notice never appears.
        await waitFor(() => expect(screen.getByLabelText('Receive at')).toHaveValue(''), WAIT);
        await waitFor(() => expect(screen.getByText(/10 XCHAIN available/i)).toBeInTheDocument(), WAIT);
        fireEvent.change(amountInput(), { target: { value: '1' } });
        expect(moveButton()).toBeEnabled();
        await act(async () => {
            moveButton().closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect((await screen.findAllByText(/Enter a destination address/i, {}, WAIT)).length)
            .toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('blocks malformed token ids and out-of-range custom fee rates', async () => {
        mount({ initialTick: '^0', balances: { '^0': '10' } });
        expect(await screen.findByText(/Token can be a name, or \^ followed by the token's number/i, {}, WAIT))
            .toBeInTheDocument();
        expect(moveButton()).toBeEnabled();

        cleanup();
        const messaging = mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        // The fee selector sits in the closed Fees section.
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees\b/ }));
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        // Custom opened the Network fee line's one editor (G113).
        fireEvent.change(networkFeeEditor(), { target: { value: '' } });
        fireEvent.click(moveButton());
        expect(await screen.findAllByText('Enter a custom network fee.')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await screen.findByRole('form', { name: 'Move across networks' }, WAIT);
        const feeToggle = screen.getByRole('button', { name: /^Speed and Fees\b/ });
        if (feeToggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(feeToggle);
        await waitFor(() => expect(
            screen.getByRole('button', { name: /^Speed and Fees\b/ }),
        ).toHaveAttribute('aria-expanded', 'true'), WAIT);
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '2' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(networkFeeEditor(), { target: { value: feeForRate(50000, BTC) } });
        fireEvent.click(moveButton());
        expect(await screen.findAllByText('Enter a rate no higher than 1,000 sat/vB.')).toHaveLength(1);
        expect(messaging.composeForConfirm).toHaveBeenLastCalledWith(expect.objectContaining({
            encoderOpts: expect.objectContaining({ feePerKb: 50000000 }),
        }));
    });

    it('refuses review when fresh bridge settings differ from the displayed route', async () => {
        // Only the depth moves, so the route stays open and the refresh notice is the one message.
        const getTokenInfo = vi.fn()
            .mockResolvedValueOnce({ bridgeChains: 'DOGE', minDepth: '6' })
            .mockResolvedValue({ bridgeChains: 'DOGE', minDepth: '12' });
        const messaging = mount({
            initialTick: 'FUFU',
            balances: { FUFU: '10' },
            getTokenInfo,
        });
        // The route is known once the first token read has opened the destination.
        await waitFor(() => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address), WAIT);
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.click(moveButton());

        expect(await screen.findByText(/bridge settings changed/i, {}, WAIT)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('turns watcher build failures into plain user copy', async () => {
        const buildActionPsbtRequest = vi.fn().mockRejectedValue(
            new Error('composer.internal: exploded at field DEST_ADDRESS'),
        );
        mount({ walletMode: 'watcher', buildActionPsbtRequest });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.click(moveButton());
        const alert = await screen.findByRole('alert', {}, WAIT);
        expect(alert).toHaveTextContent("Couldn't complete this; something went wrong. Try again.");
        expect(alert).not.toHaveTextContent(/composer\.internal/);
    });
});

// One message per state: a refusal from an earlier Review press describes a
// form that no longer exists once a field changes, and the live refusal for
// the current values is the one the page states.
describe('BridgeMoveForm: one message for the current state', () => {
    it('drops the empty-amount refusal once an amount is typed', async () => {
        mount({ balances: { XCHAIN: '10' } });
        await waitFor(
            () => expect(screen.getByText(/10 XCHAIN available/i)).toBeInTheDocument(),
            WAIT,
        );
        fireEvent.click(moveButton());
        expect((await screen.findAllByText('Enter an amount to move.', {}, WAIT)).length).toBeGreaterThan(0);

        fireEvent.change(amountInput(), { target: { value: '11' } });
        await screen.findByText(/You hold 10 XCHAIN at the source address/i, {}, WAIT);
        expect(screen.queryByText('Enter an amount to move.')).toBeNull();
    });

    it('states only the refreshed route refusal after the bridge settings change under the form', async () => {
        const getTokenInfo = vi.fn()
            .mockResolvedValueOnce({ bridgeChains: 'DOGE', minDepth: '6' })
            .mockResolvedValue({ bridgeChains: 'LTC', minDepth: '12' });
        mount({ initialTick: 'FUFU', balances: { FUFU: '10' }, getTokenInfo });
        // The route is known once the first token read has opened the destination.
        await waitFor(() => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address), WAIT);
        fireEvent.change(amountInput(), { target: { value: '1' } });
        fireEvent.click(moveButton());

        expect(await screen.findByText(/bridge settings changed/i, {}, WAIT)).toBeInTheDocument();
        expect(screen.queryByText('This token cannot move to the selected destination network.')).toBeNull();
    });
});

// The refusal leads the page, far above the Review button on a phone, so the
// press that raised it moves focus there and the user sees why nothing opened.
describe('BridgeMoveForm: a Review refusal takes focus', () => {
    it('focuses the empty-amount refusal raised by the Review press', async () => {
        mount();
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        moveButton().focus();
        fireEvent.click(moveButton());
        const refusal = await screen.findByRole('alert', { name: 'Form errors' }, WAIT);
        expect(refusal).toHaveTextContent('Enter an amount to move.');
        await waitFor(() => expect(document.activeElement?.contains(refusal)).toBe(true), WAIT);
    });

    it('focuses a compose failure that arrives after the press', async () => {
        const composeForConfirm = vi.fn().mockRejectedValue(new Error('Insufficient funds for fee'));
        mount({ composeForConfirm });
        await waitFor(
            () => expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address),
            WAIT,
        );
        fireEvent.change(amountInput(), { target: { value: '1' } });
        moveButton().focus();
        fireEvent.click(moveButton());
        const alert = await screen.findByRole('alert', {}, WAIT);
        await waitFor(() => expect(document.activeElement).toBe(alert), WAIT);
    });
});

// XBRIDGE pays one flat fee (GAS_SCHEDULE.XBRIDGE_BASE) for every
// user-broadcast version, so Speed and Fees shows it from the chain's fee
// schedule before the form is complete enough to quote.
describe('BridgeMoveForm: protocol fee before review', () => {
    it('shows the flat XBRIDGE fee with no amount entered, never Priced at review', async () => {
        const getFeeSchedule = vi.fn().mockResolvedValue({
            gasPrice: '0.00001',
            gasSchedule: { XBRIDGE_BASE: 5000 },
            prices: { available: false },
        });
        mount({ getFeeSchedule });
        await waitFor(
            () => expect(document.querySelector('[data-fees-row="protocol"]')).toHaveTextContent('0.05 XCHAIN'),
            WAIT,
        );
        expect(document.querySelector('[data-fees-row="protocol"]').textContent).not.toMatch(/Priced at review/);
        expect(getFeeSchedule).toHaveBeenCalledTimes(1);
    });
});
