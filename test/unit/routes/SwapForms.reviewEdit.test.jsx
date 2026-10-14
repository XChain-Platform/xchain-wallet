// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const pickerSelection = vi.hoisted(() => ({ give: 'ALPHA', get: 'BETA' }));

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: title.includes('give') ? 'dogecoin-mainnet' : 'bitcoin-mainnet',
                tick: title.includes('give') ? pickerSelection.give : pickerSelection.get,
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
    cleanup();
    __clearTokenInfoCache();
    pickerSelection.give = 'ALPHA';
    pickerSelection.get = 'BETA';
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
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
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

describe('swap review editing', () => {
    it('keeps Memo visible beside a compact advanced-options disclosure', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );

        const memo = await screen.findByLabelText('Memo (optional)');
        const disclosure = screen.getByRole('button', { name: 'Advanced options' });
        const controlledId = disclosure.getAttribute('aria-controls');

        expect(memo).toBeVisible();
        expect(memo).toHaveAttribute('id', 'swap-memo');
        expect(getComputedStyle(memo).borderTopStyle).not.toBe('none');
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(disclosure.querySelector('svg')).not.toBeNull();
        expect(screen.queryByText('Advanced options (receive address, lists)')).toBeNull();

        fireEvent.click(disclosure);
        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById(controlledId)).toBeVisible();
        expect(screen.getByLabelText('Receive at (optional)')).toBeVisible();
    });

    it('treats a tiny plain decimal as positive without floating-point underflow', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        const tiny = `0.${'0'.repeat(400)}1`;
        setAmount('Give amount (ALPHA)', tiny);
        setAmount('Get amount (BETA)', '1');

        expect(screen.queryByText('Give amount must be a positive decimal number.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled();
    });

    it('blocks non-positive same-chain amounts before review', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging()}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Get token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '0');
        setAmount('Get amount (BETA)', '1');

        expect(await screen.findByText('Give amount must be a positive decimal number.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '1.000000000000000002');
        setAmount('Get amount (BETA)', '1');

        expect(await screen.findByText('Give amount is above your available ALPHA balance.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: 'not an address' } });
        expect(await screen.findByText('This address has a typo. Check it and try again.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: BTC_ADDRESS.address } });
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        expect(await screen.findByText('Pick an expiration date and time, or switch to the default window.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(screen.getByText('Enter a valid custom network fee rate before reviewing.')).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const edit = await screen.findByRole('button', { name: 'Edit' });
        expect(screen.getByText('1 ALPHA = 1.5 BETA')).toBeInTheDocument();
        expect(screen.getByText(/The give side is escrowed until this offer is matched/)).toBeInTheDocument();
        expect(screen.getByText('Give chain')).toBeInTheDocument();
        expect(screen.getByText('Get chain')).toBeInTheDocument();
        expect(screen.getByText('Protocol fee')).toBeInTheDocument();
        fireEvent.click(edit);
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await screen.findByRole('button', { name: 'Edit' });
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await screen.findByRole('button', { name: 'Create unsigned transaction' });

        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-02T03:05'));
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '1000000000');
        setAmount('Get amount (BETA)', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: `  ${BTC_RECIPIENT}  ` } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: '  exact memo  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const giveValue = await screen.findByText('2 ALPHA');
        const details = giveValue.closest('dl');
        expect(details).not.toBeNull();
        expect(within(details).getByText('2 ALPHA')).toBeInTheDocument();
        expect(within(details).getByText('3 BETA')).toBeInTheDocument();
        const expiration = String(Math.floor(Date.parse('2099-01-02T03:04') / 1000));
        expect(within(details).getByText(formatLocalDateTime(expiration))).toBeInTheDocument();
        expect(within(details).getByLabelText(BTC_RECIPIENT)).toBeInTheDocument();
        expect(within(details).getByText('exact memo')).toBeInTheDocument();
        expect(within(details).getAllByText('None')).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: `  ${BTC_ADDRESS.address}  ` } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: '  exact memo  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await screen.findByRole('button', { name: 'Edit' });
        expect(screen.getByText('1 ALPHA = 1.25 BETA')).toBeInTheDocument();
        expect(screen.getByText('Give chain')).toBeInTheDocument();
        expect(screen.getByText('Get chain')).toBeInTheDocument();
        expect(screen.getByText('Protocol fee')).toBeInTheDocument();
        expect(screen.getByLabelText(BTC_ADDRESS.address)).toBeInTheDocument();
        expect(screen.getByText('exact memo')).toBeInTheDocument();
        expect(screen.getByText(/Paid transaction fees are not refunded/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(await screen.findByLabelText('Give amount (ALPHA)')).toHaveValue('4');
        expect(screen.getByLabelText('Get amount (BETA)')).toHaveValue('5');
        expect(screen.getByLabelText('Receive at')).toHaveValue(`  ${BTC_ADDRESS.address}  `);
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue('  exact memo  ');
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await screen.findByRole('button', { name: 'Edit' });
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await screen.findByRole('button', { name: 'Create unsigned transaction' });

        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-02T03:05'));
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (^0)', '1');
        setAmount('Get amount (BETA)', '2');

        expect(await screen.findByText("Give token can be a name, or ^ followed by the token's number (^123)."))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount(/^Give amount/, '1');
        setAmount('Get amount (BETA)', '2');
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('Enter the give and get tickers and amounts, or select ownership, before reviewing.'))
            .toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

        pickerSelection.give = 'ALPHA';
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        setAmount('Give amount (ALPHA)', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Enter a receive address on the get chain.')).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        setAmount('Give amount (ALPHA)', '9');
        pickerSelection.give = 'OTHER';
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        const start = Date.now();
        const expiration = new Date(start + 60_000);
        const localExpiration = new Date(expiration.getTime() - expiration.getTimezoneOffset() * 60_000)
            .toISOString().slice(0, 16);
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: localExpiration } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await screen.findByRole('button', { name: 'Create unsigned transaction' });

        vi.spyOn(Date, 'now').mockReturnValue(start + 120_000);
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        const start = Date.now();
        const expiration = new Date(start + 60_000);
        const localExpiration = new Date(expiration.getTime() - expiration.getTimezoneOffset() * 60_000)
            .toISOString().slice(0, 16);
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: localExpiration } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '1000000000');
        setAmount('Get amount (BETA)', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('1 ALPHA = < 0.00000001 BETA')).toBeInTheDocument();
        expect(screen.queryByText('1 ALPHA = 0 BETA')).toBeNull();
    });

    it('clears chain-scoped tokens, amounts, and the receive address when either chain changes', async () => {
        let resolveLitecoinAddress;
        const litecoinAddress = new Promise((resolve) => { resolveLitecoinAddress = resolve; });
        const byChain = {
            [DOGE]: [DOGE_ADDRESS],
            [BTC]: [BTC_ADDRESS],
            [LTC]: [LTC_ADDRESS],
        };
        const msg = messaging({
            byChain,
            getNewestAddress: vi.fn().mockImplementation((_walletId, chainId) => (
                chainId === LTC ? litecoinAddress : Promise.resolve(byChain[chainId][0])
            )),
        });
        render(
            <MessagingProvider shell="desktop" messaging={msg}>
                <CrossChainSwapForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        setAmount('Give amount (ALPHA)', '4');

        fireEvent.click(screen.getByRole('button', { name: 'Give chain: Dogecoin' }));
        fireEvent.click(screen.getByRole('option', { name: /Bitcoin/ }));
        expect(screen.getByLabelText('Give amount')).toHaveValue('');
        expect(screen.getByRole('button', { name: /Give token:/ })).toHaveTextContent('Select a token');

        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Get amount (BETA)', '5');
        expect(screen.getByLabelText('Receive at')).toHaveValue(BTC_ADDRESS.address);

        fireEvent.click(screen.getByRole('button', { name: 'Get chain: Bitcoin' }));
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));
        expect(screen.getByLabelText('Get amount')).toHaveValue('');
        expect(screen.getByLabelText('Receive at')).toHaveValue('');
        expect(screen.getByRole('button', { name: /Get token:/ })).toHaveTextContent('Select a token');

        await act(async () => { resolveLitecoinAddress(LTC_ADDRESS); });
        expect(screen.getByLabelText('Receive at')).toHaveValue(LTC_ADDRESS.address);
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '1');
        setAmount('Get amount (BETA)', '2');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        const form = submit.closest('form');
        await act(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '.');
        setAmount('Get amount (BETA)', '1');

        expect(await screen.findByText('Give amount must be a positive decimal number.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        expect(await screen.findByText('Give amount is above your available ALPHA balance.')).toBeInTheDocument();

        setAmount('Give amount (ALPHA)', '1');
        await waitFor(() => expect(screen.queryByText('Give amount is above your available ALPHA balance.')).toBeNull());
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: 'not an address' } });
        expect(await screen.findByText('This address has a typo. Check it and try again.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: BTC_ADDRESS.address } });
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        expect(await screen.findByText('Pick an expiration date and time, or switch to the default window.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        setAmount('Give amount (ALPHA)', '2');
        setAmount('Get amount (BETA)', '3');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(screen.getByText('Enter a valid custom network fee rate before reviewing.')).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        fireEvent.click(screen.getByLabelText('Give this token\'s ownership (not a balance)'));
        fireEvent.click(screen.getByLabelText('Require the matcher to give that token\'s ownership'));
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('ownership of ALPHA')).toBeInTheDocument();
        expect(screen.getByText('ownership of BETA')).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        await waitFor(() => expect(msg.getTokenInfo).toHaveBeenCalledWith({
            chainId: BTC,
            tick: 'ALPHA',
            demo: false,
        }));
        setAmount('Give amount (ALPHA)', '1.5');
        setAmount('Get amount (BETA)', '1.25');

        expect(await screen.findByText('Give amount must be a whole number because ALPHA is indivisible.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('validates cross-chain token precision on the chain for each leg', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('labels the full-wallet action as review and uses narrow-safe form sections', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging({ walletMode: 'full' })}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('button', { name: 'Review' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Swap' })).toBeNull();
        expect(screen.getByRole('region', { name: 'You give' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'You get' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Timing and fees' })).toBeInTheDocument();
    });
});
