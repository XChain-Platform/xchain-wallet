// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: title.includes('give') ? 'dogecoin-mainnet' : 'bitcoin-mainnet',
                tick: title.includes('give') ? 'ALPHA' : 'BETA',
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

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const address = (id, value) => ({
    id, address: value, publicKey: '02ab', derivationPath: "m/44'/0'/0'/0/0", source: 'hd', signerId: 's1',
});
const BTC_ADDRESS = address('btc-a', 'bc1qexample');
const DOGE_ADDRESS = address('doge-a', 'DExample');

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function messaging({ walletMode = 'watcher', divisibility = {} } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockResolvedValue(BTC_ADDRESS),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'watcher' }),
        getTokenInfo: vi.fn().mockImplementation(({ chainId, tick }) => Promise.resolve({
            chainId,
            tick,
            divisibility: divisibility[`${chainId}:${tick}`] ?? null,
        })),
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

    it('shows every same-chain offer term on the watcher review', async () => {
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
        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2099-01-02T03:04' } });
        fireEvent.click(screen.getByRole('button', { name: 'Advanced options (receive address, lists)' }));
        fireEvent.change(screen.getByLabelText('Receive at (optional)'), { target: { value: 'bc1qrecipient' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const giveValue = await screen.findByText('2 ALPHA');
        const details = giveValue.closest('dl');
        expect(details).not.toBeNull();
        expect(within(details).getByText('2 ALPHA')).toBeInTheDocument();
        expect(within(details).getByText('3 BETA')).toBeInTheDocument();
        expect(within(details).getByText(new Date('2099-01-02T03:04').toLocaleString())).toBeInTheDocument();
        expect(within(details).getByText('bc1qrecipient')).toBeInTheDocument();
        expect(within(details).getAllByText('None')).toHaveLength(2);
    });

    it('returns from the cross-chain review to the populated form', async () => {
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
        setAmount('Give amount (ALPHA)', '4');
        setAmount('Get amount (BETA)', '5');
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const edit = await screen.findByRole('button', { name: 'Edit' });
        expect(screen.getByText('1 ALPHA = 1.25 BETA')).toBeInTheDocument();
        expect(screen.getByText('Give chain')).toBeInTheDocument();
        expect(screen.getByText('Get chain')).toBeInTheDocument();
        expect(screen.getByText('Protocol fee')).toBeInTheDocument();
        expect(screen.getByText(/Paid transaction fees are not refunded/)).toBeInTheDocument();
        fireEvent.click(edit);
        expect(await screen.findByLabelText('Give amount (ALPHA)')).toHaveValue('4');
        expect(screen.getByLabelText('Get amount (BETA)')).toHaveValue('5');
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
