// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => {
    const actual = await importOriginal();
    const coinRate = { rate: 50000, fiatCurrency: 'EUR', source: 'oracle' };
    return {
        ...actual,
        useFiatRate: () => coinRate,
        useTickFiatRate: ({ tick }) => {
            if (tick === 'PEPECASH') {
                return { rate: 0.02, fiatCurrency: 'EUR', source: 'market' };
            }
            if (tick === 'UNKNOWN') return null;
            return coinRate;
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

afterEach(() => cleanup());

function messagingForSend() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1',
                address: FROM,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({
            fiatCurrency: 'EUR',
            grace: { testSendThresholdSats: 0 },
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function renderSend(prefill) {
    render(
        <MessagingProvider shell="web" messaging={messagingForSend()}>
            <Send walletId="wallet" prefill={prefill} onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('Send fiat currency', () => {
    it('uses the selected currency in the amount and network-fee previews', async () => {
        renderSend();

        expect(await screen.findByRole('button', { name: /switch input to eur/i })).toBeInTheDocument();
        expect(screen.getByText('≈ €0.00 EUR')).toBeInTheDocument();
        // The fee preview lands after the amount preview once the fee
        // estimate resolves, so wait for both rather than the first match.
        await waitFor(() => expect(screen.getAllByText(/≈ €[0-9,.]+ EUR/)).toHaveLength(2));
        expect(document.body.textContent).not.toContain('$');
    });

    it('shows and labels the amount preview for a DEX-priced token', async () => {
        renderSend({ chainId: CHAIN, tick: 'PEPECASH', amount: '2' });

        expect(await screen.findByRole('button', { name: /switch input to eur/i })).toBeInTheDocument();
        expect(screen.getByText('≈ €0.04 EUR · DEX price')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('€100,000.00');
    });

    it('shows no amount fiat preview for an unpriced token', async () => {
        renderSend({ chainId: CHAIN, tick: 'UNKNOWN', amount: '2' });

        expect(await screen.findByLabelText('Amount (UNKNOWN)')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /switch input to/i })).toBeNull();
        expect(document.body.textContent).not.toContain('€100,000.00');
    });
});
