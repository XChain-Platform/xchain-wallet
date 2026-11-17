// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { openSection } from '../../helpers/openFormSections.js';
import { networkFeeEditor } from '../../helpers/customNetworkFee.js';

const pickerSelection = vi.hoisted(() => ({
    give: 'ALPHA',
    get: 'BETA',
    giveChain: 'dogecoin-mainnet',
    getChain: 'bitcoin-mainnet',
}));

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: /give/i.test(title) ? pickerSelection.giveChain : pickerSelection.getChain,
                tick: /give/i.test(title) ? pickerSelection.give : pickerSelection.get,
            })}
        >
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';
const address = (id, value) => ({
    id, address: value, publicKey: '02ab', derivationPath: "m/44'/0'/0'/0/0", source: 'hd', signerId: 's1',
});
const BTC_ADDRESS = address('btc-a', 'bc1qdevmock02ab');
const DOGE_ADDRESS = address('doge-a', 'Ddevmock02ab');
const LTC_ADDRESS = address('ltc-a', 'ltc1qdevmock02ab');
const BTC_RECIPIENT = 'bc1qdevmockabcdef';

afterEach(() => {
    // The Quick | Full choice is remembered per form; start each test on Quick.
    globalThis.localStorage?.clear();
    cleanup();
    resetWalletModes();
    __clearTokenInfoCache();
    pickerSelection.give = 'ALPHA';
    pickerSelection.get = 'BETA';
    pickerSelection.giveChain = DOGE;
    pickerSelection.getChain = BTC;
    vi.restoreAllMocks();
});

function messaging({
    walletMode = 'watcher',
    divisibility = {},
    balances = {},
    byChain = { [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] },
    getNewestAddress,
    buildActionPsbtRequest,
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    }),
} = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: getNewestAddress || vi.fn().mockImplementation((_walletId, chainId) => (
            Promise.resolve((byChain[chainId] || [])[0] || null)
        )),
        getWalletBalances: vi.fn().mockResolvedValue(Object.fromEntries(
            Object.entries(byChain).map(([chainId, addrs]) => [chainId, addrs.map((entry) => ({
                address: entry.address,
                balances: {
                    tokens: ['ALPHA', 'BETA'].map((tick) => {
                        const balance = String(balances[`${chainId}:${tick}`] ?? '100');
                        return {
                            tick,
                            quantity: balance.includes('.') ? balance : `${balance}.0`,
                            divisibility: divisibility[`${chainId}:${tick}`] ?? 8,
                        };
                    }),
                },
            }))]),
        )),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode }]),
        signerReady: vi.fn().mockResolvedValue({ ready: walletMode === 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'watcher' }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        swapAction: vi.fn().mockResolvedValue({ txid: 'swap-tx' }),
        getTokenInfo: vi.fn().mockImplementation(({ chainId, tick }) => Promise.resolve({
            chainId,
            tick,
            divisibility: divisibility[`${chainId}:${tick}`] ?? null,
        })),
        ...(buildActionPsbtRequest ? { buildActionPsbtRequest } : {}),
    };
    // The wallet's own mode comes from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function setAmount(label, value) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

// Receive at is a typed field only in the Full view; Quick picks it from the wallet.
function showFull() {
    fireEvent.click(screen.getByRole('radio', { name: 'Full' }));
}

describe('swap review editing', () => {
    it('keeps Receive at inside the closed Swap Terms section, and Memo in its own section', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );

        const memo = await screen.findByLabelText('Memo');
        const receiveAt = screen.getByLabelText('Receive at');
        const disclosure = screen.getByRole('button', { name: /^Swap Terms/ });
        const controlledId = disclosure.getAttribute('aria-controls');

        expect(memo).not.toBeVisible();
        expect(memo).toHaveAttribute('id', 'swap-memo');
        expect(receiveAt).not.toBeVisible();
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(disclosure.querySelector('svg')).not.toBeNull();
        expect(screen.queryByText('Advanced options')).toBeNull();

        fireEvent.click(disclosure);
        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById(controlledId)).toBeVisible();
        expect(receiveAt).toBeVisible();
        // Memo is its own section (operator 2026-11-13), still closed.
        expect(memo).not.toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /^Memo/ }));
        expect(memo).toBeVisible();
        expect(getComputedStyle(memo).borderTopStyle).not.toBe('none');
    });

    it('treats a tiny plain decimal as positive without floating-point underflow', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        const tiny = `0.${'0'.repeat(400)}1`;
        setAmount('Give amount (ALPHA)', tiny);
        setAmount('Get amount (BETA)', '1');

        expect(screen.queryByText('Give amount must be a positive decimal number.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create Swap' })).toBeEnabled();
    });

    it('blocks non-positive same-chain amounts before review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '0');
        setAmount('Get amount (BETA)', '1');

        expect(await screen.findByText('Give amount must be a positive decimal number.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('blocks a same-chain give amount above the exact available balance', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging({
                balances: { [`${BTC}:ALPHA`]: '1.000000000000000001' },
            })}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1.000000000000000002');
        setAmount('Get amount (BETA)', '1');

        expect(await screen.findByText('Give amount is above your available ALPHA balance.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('blocks a malformed same-chain recipient and an empty custom expiry', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        await openSection('Swap Terms');
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: 'not an address' } });
        expect(await screen.findByText('This is not a valid address.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: BTC_ADDRESS.address } });
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        // The specific time starts from the Expires shown; clearing it is the empty expiry.
        expect(screen.getByLabelText('Expires')).not.toHaveValue('');
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '' } });
        expect(await screen.findByText('Pick an expiration date and time, or choose a common term.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('blocks an invalid same-chain custom network fee before review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        await openSection('Speed and Fees');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(networkFeeEditor(), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        expect(screen.getAllByText('Custom fee rate must be greater than zero.')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('returns from the same-chain review to the populated form', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        const reject = await screen.findByRole('button', { name: 'Reject' });
        expect(screen.getByText('1 ALPHA = 1.5 BETA')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-fee-network')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-facts')).toBeInTheDocument();
        expect(screen.queryByText('Estimate unavailable')).toBeNull();
        fireEvent.click(reject);
        expect(await screen.findByLabelText('Give amount (ALPHA)')).toHaveValue('2');
        expect(screen.getByLabelText('Get amount (BETA)')).toHaveValue('3');
    });

    it('uses the same-chain review header Back action to keep the populated form', async () => {
        const onBack = vi.fn();
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={onBack} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        await screen.findByRole('button', { name: 'Reject' });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByLabelText('Give amount (ALPHA)')).toHaveValue('2');
        expect(screen.getByLabelText('Get amount (BETA)')).toHaveValue('3');
        expect(onBack).not.toHaveBeenCalled();
    });

    it('refuses a same-chain watcher build when its reviewed expiration has passed', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: 'aa00' });
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ buildActionPsbtRequest })}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));
        await screen.findByRole('button', { name: 'Approve' });

        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-02T03:05'));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(await screen.findByText('Expiration must be in the future.')).toBeInTheDocument();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('does not show a positive same-chain rate as zero', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1000000000');
        setAmount('Get amount (BETA)', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        expect(await screen.findByText('1 ALPHA = < 0.00000001 BETA')).toBeInTheDocument();
        expect(screen.queryByText('1 ALPHA = 0 BETA')).toBeNull();
    });

    it('shows every same-chain offer term from the exact built values on watcher review', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: 'aa00' });
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ buildActionPsbtRequest })}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        await openSection('Swap Terms');
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: `  ${BTC_RECIPIENT}  ` } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '  exact memo  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        const sentence = await screen.findByTestId('confirm-sentence');
        expect(sentence).toHaveTextContent('2 ALPHA');
        expect(sentence).toHaveTextContent('3 BETA');
        const details = screen.getByTestId('confirm-facts');
        const expiration = String(Math.floor(Date.parse('2099-01-02T03:04') / 1000));
        expect(within(details).getByText(formatLocalDateTime(expiration))).toBeInTheDocument();
        expect(within(details).getByTitle(BTC_RECIPIENT)).toBeInTheDocument();
        expect(within(details).getByText('exact memo')).toBeInTheDocument();
        expect(screen.queryByText('Estimate unavailable')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            actionData: expect.objectContaining({
                params: expect.objectContaining({
                    GIVE_AMOUNT: '2',
                    GET_AMOUNT: '3',
                    GET_ADDRESS: BTC_RECIPIENT,
                    EXPIRATION: expiration,
                    MEMO: 'exact memo',
                }),
            }),
        })));
    });

    it('cross-chain watcher review matches built normalized values and Back keeps form values', async () => {
        const onBack = vi.fn();
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={onBack} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        showFull();
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: `  ${BTC_ADDRESS.address}  ` } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '  exact memo  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        await screen.findByRole('button', { name: 'Reject' });
        expect(screen.getByText('1 ALPHA = 1.25 BETA')).toBeInTheDocument();
        expect(screen.getByTitle(BTC_ADDRESS.address)).toBeInTheDocument();
        expect(screen.getByText('exact memo')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-fee-network')).toBeInTheDocument();
        expect(screen.queryByText('Estimate unavailable')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(await screen.findByLabelText('Give amount (ALPHA)')).toHaveValue('4');
        expect(screen.getByLabelText('Get amount (BETA)')).toHaveValue('5');
        expect(screen.getByLabelText('Receive at')).toHaveValue(`  ${BTC_ADDRESS.address}  `);
        expect(screen.getByLabelText('Memo')).toHaveValue('  exact memo  ');
    });

    it('uses the cross-chain review header Back action to keep the populated form', async () => {
        const onBack = vi.fn();
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={onBack} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        await screen.findByRole('button', { name: 'Reject' });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByLabelText('Give amount (ALPHA)')).toHaveValue('4');
        expect(screen.getByLabelText('Get amount (BETA)')).toHaveValue('5');
        expect(onBack).not.toHaveBeenCalled();
    });

    it('refuses a cross-chain watcher build when its reviewed expiration has passed', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: 'aa00' });
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ buildActionPsbtRequest })}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        await screen.findByRole('button', { name: 'Approve' });

        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-02T03:05'));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(await screen.findByText('Expiration must be a future date and time.')).toBeInTheDocument();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('blocks a malformed cross-chain token ID supplied by the picker', async () => {
        pickerSelection.give = '^0';
        const buildActionPsbtRequest = vi.fn();
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ buildActionPsbtRequest })}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (^0)', '1');
        setAmount('Get amount (BETA)', '2');

        expect(await screen.findByText("Give token can be a name, or ^ followed by the token's number (^123)."))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('treats whitespace-only cross-chain token and receive values as empty', async () => {
        pickerSelection.give = '   ';
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount(/^Give amount/, '1');
        setAmount('Get amount (BETA)', '2');
        showFull();
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        expect(await screen.findByText('Enter the give and get tickers and amounts, or select ownership, before reviewing.'))
            .toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

        pickerSelection.give = 'ALPHA';
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        setAmount('Give amount (ALPHA)', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        expect(await screen.findByText('Enter a receive address on the get network.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('clears a cross-chain amount when the picker changes its token', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        setAmount('Give amount (ALPHA)', '9');
        pickerSelection.give = 'OTHER';
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));

        expect(screen.getByLabelText('Give amount (OTHER)')).toHaveValue('');
    });

    it('refuses a custom expiration that expires while watcher review is open', async () => {
        const buildActionPsbtRequest = vi.fn();
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ buildActionPsbtRequest })}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        const start = Date.now();
        const expiration = new Date(start + 60_000);
        const localExpiration = new Date(expiration.getTime() - expiration.getTimezoneOffset() * 60_000)
            .toISOString().slice(0, 16);
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: localExpiration } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        await screen.findByRole('button', { name: 'Approve' });

        vi.spyOn(Date, 'now').mockReturnValue(start + 120_000);
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(await screen.findByText('Expiration must be a future date and time.')).toBeInTheDocument();
        expect(screen.getByLabelText('Give amount (ALPHA)')).toHaveValue('1');
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a custom expiration that expires on the full-wallet confirmation', async () => {
        const msg = messaging({ walletMode: 'full' });
        render(
            <MessagingProvider shell="desktop" messaging={msg}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        const start = Date.now();
        const expiration = new Date(start + 60_000);
        const localExpiration = new Date(expiration.getTime() - expiration.getTimezoneOffset() * 60_000)
            .toISOString().slice(0, 16);
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: localExpiration } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());

        vi.spyOn(Date, 'now').mockReturnValue(start + 120_000);
        fireEvent.click(approve);

        expect(await screen.findByText('Expiration must be a future date and time.')).toBeInTheDocument();
        expect(msg.swapAction).not.toHaveBeenCalled();
    });

    it('does not show a positive cross-chain rate as zero', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1000000000');
        setAmount('Get amount (BETA)', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        expect(await screen.findByText('1 ALPHA = < 0.00000001 BETA')).toBeInTheDocument();
        expect(screen.queryByText('1 ALPHA = 0 BETA')).toBeNull();
    });

    it('clears chain-scoped tokens, amounts, and the receive address when either network changes', async () => {
        // Each side's network follows its token, so a token picked on another
        // network is how either network changes.
        let resolveDogecoinAddress;
        const dogecoinAddress = new Promise((resolve) => { resolveDogecoinAddress = resolve; });
        const byChain = {
            [DOGE]: [DOGE_ADDRESS],
            [BTC]: [BTC_ADDRESS],
            [LTC]: [LTC_ADDRESS],
        };
        const msg = messaging({
            byChain,
            getNewestAddress: vi.fn().mockImplementation((_walletId, chainId) => (
                chainId === DOGE ? dogecoinAddress : Promise.resolve(byChain[chainId][0])
            )),
        });
        render(
            <MessagingProvider shell="desktop" messaging={msg}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        setAmount('Give amount (ALPHA)', '4');

        // A give token on Litecoin moves the give network and drops the amount.
        pickerSelection.giveChain = LTC;
        pickerSelection.give = 'OTHER';
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        expect(screen.getByLabelText('Give amount (OTHER)')).toHaveValue('');

        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Get amount (BETA)', '5');
        showFull();
        expect(screen.getByLabelText('Receive at')).toHaveValue(BTC_ADDRESS.address);

        // A get token on Dogecoin moves the get network, clears the receive
        // address and its amount, and the Dogecoin address fills in once read.
        pickerSelection.getChain = DOGE;
        pickerSelection.get = 'ZETA';
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        expect(screen.getByLabelText('Get amount (ZETA)')).toHaveValue('');
        expect(screen.getByLabelText('Receive at')).toHaveValue('');

        await act(async () => { resolveDogecoinAddress(DOGE_ADDRESS); });
        expect(screen.getByLabelText('Receive at')).toHaveValue(DOGE_ADDRESS.address);
    });

    it('locks the cross-chain swap fields while the review composes', async () => {
        let resolveCompose;
        const composeForConfirm = vi.fn(() => new Promise((resolve) => { resolveCompose = resolve; }));
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ walletMode: 'full', composeForConfirm })}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        showFull();
        await waitFor(() => expect(screen.getByLabelText('Receive at')).toHaveValue(BTC_ADDRESS.address));
        const create = screen.getByRole('button', { name: 'Create Cross-Chain Swap' });
        fireEvent.click(create);

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(create.closest('form')).toHaveAttribute('inert');
        expect(create.closest('form')).toHaveAttribute('aria-busy', 'true');
        await act(async () => { resolveCompose(null); });
    });

    it('dispatches one watcher build when the review form is submitted twice in one turn', async () => {
        let resolveBuild;
        const build = new Promise((resolve) => { resolveBuild = resolve; });
        const buildActionPsbtRequest = vi.fn(() => build);
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ buildActionPsbtRequest })}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        const submit = await screen.findByRole('button', { name: 'Approve' });
        await act(async () => {
            fireEvent.click(submit);
            fireEvent.click(submit);
        });
        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);

        await act(async () => { resolveBuild({ psbtHex: 'aa00' }); });
    });

    it('blocks incomplete cross-chain decimal amounts before review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '.');
        setAmount('Get amount (BETA)', '1');

        expect(await screen.findByText('Give amount must be a positive decimal number.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('blocks cross-chain balance, recipient, and empty-expiry gaps before review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging({
                balances: { [`${DOGE}:ALPHA`]: '1' },
            })}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        expect(await screen.findByText('Give amount is above your available ALPHA balance.')).toBeInTheDocument();

        setAmount('Give amount (ALPHA)', '1');
        await waitFor(() => expect(screen.queryByText('Give amount is above your available ALPHA balance.')).toBeNull());
        showFull();
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: 'not an address' } });
        expect(await screen.findByText('This is not a valid address.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: BTC_ADDRESS.address } });
        fireEvent.click(screen.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        fireEvent.click(screen.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        // The specific time starts from the Expires shown; clearing it is the empty expiry.
        expect(screen.getByLabelText('Expires')).not.toHaveValue('');
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '' } });
        expect(await screen.findByText('Pick an expiration date and time, or choose a common term.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('blocks an invalid cross-chain custom network fee before review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        await openSection('Speed and Fees');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(networkFeeEditor(), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        expect(screen.getAllByText('Custom fee rate must be greater than zero.')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('names ownership legs explicitly in the cross-chain review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        await openSection('Ownership');
        fireEvent.click(screen.getByLabelText('Give this token\'s ownership instead of an amount'));
        fireEvent.click(screen.getByLabelText('Require the matcher to give that token\'s ownership instead of an amount'));
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('ownership of ALPHA');
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('ownership of BETA');
    });

    it('validates each same-chain token amount against its own precision', async () => {
        const msg = messaging({ divisibility: {
            [`${BTC}:ALPHA`]: 0,
            [`${BTC}:BETA`]: 2,
        } });
        render(
            <MessagingProvider shell="desktop" messaging={msg}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        await waitFor(() => expect(msg.getTokenInfo).toHaveBeenCalledWith({
            chainId: BTC,
            tick: 'ALPHA',
            demo: false,
        }));
        setAmount('Give amount (ALPHA)', '1.5');
        setAmount('Get amount (BETA)', '1.25');

        expect(await screen.findByText('Give amount must be a whole number because ALPHA is indivisible.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('validates cross-chain token precision on the network for each leg', async () => {
        const msg = messaging({ divisibility: {
            [`${DOGE}:ALPHA`]: 2,
            [`${BTC}:BETA`]: 0,
        } });
        render(
            <MessagingProvider shell="desktop" messaging={msg}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Give Token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        await waitFor(() => expect(msg.getTokenInfo).toHaveBeenCalledWith({
            chainId: BTC,
            tick: 'BETA',
            demo: false,
        }));
        setAmount('Give amount (ALPHA)', '1.25');
        setAmount('Get amount (BETA)', '2.5');

        expect(await screen.findByText('Get amount must be a whole number because BETA is indivisible.'))
            .toBeInTheDocument();
        expect(msg.getTokenInfo).toHaveBeenCalledWith({ chainId: DOGE, tick: 'ALPHA', demo: false });
        fireEvent.click(screen.getByRole('button', { name: 'Create Cross-Chain Swap' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('labels the full-wallet action by outcome and uses narrow-safe form sections', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ walletMode: 'full' })}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );

        const create = await screen.findByRole('button', { name: 'Create Swap' });
        expect(create).toHaveAttribute('type', 'submit');
        // The only control named "Swap" is the main section's header, never an action.
        for (const control of screen.queryAllByRole('button', { name: 'Swap' })) {
            expect(control).toHaveAttribute('data-form-section-toggle');
        }
        expect(screen.getByRole('region', { name: 'You give' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'You get' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Timing and fees' })).toBeNull();
        expect(screen.getByRole('button', { name: /^Swap Terms/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Speed and Fees/ })).toBeInTheDocument();
    });
});
