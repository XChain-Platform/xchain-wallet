// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function mount({ nativeQuantity = '100000000', tokens = [], quote } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
                id: 'address-1',
                address: FROM,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_ID]: { id: 'address-1', address: FROM },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: nativeQuantity, divisibility: 8 },
            tokens,
        }),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0 },
            fees: { [CHAIN_ID]: { strategy: 'normal', rbfByDefault: true } },
            privacy: { formDraftTtlMs: 0 },
        }),
        estimateFee: vi.fn().mockResolvedValue(null),
        quoteMaxSendable: quote || vi.fn().mockResolvedValue({
            maxSats: '99999000',
            feeSats: '1000',
            inputSats: '100000000',
            otherOutputSats: '0',
            source: 'encoder-quote',
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
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
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Send walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function prepareNativeMax() {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    const max = await screen.findByRole('button', { name: 'Use max available amount' });
    await waitFor(() => expect(max).toBeEnabled());
    fireEvent.click(max);
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Send Max', () => {
    it('re-quotes an active native Max when the selected fee rate changes', async () => {
        const quote = vi.fn().mockImplementation(async ({ feePerKb }) => {
            const fee = feePerKb === 12000 ? 2000 : 1000;
            return {
                maxSats: String(100000000 - fee),
                feeSats: String(fee),
                inputSats: '100000000',
                otherOutputSats: '0',
                source: 'encoder-quote',
            };
        });
        mount({ quote });
        await prepareNativeMax();

        await waitFor(() => expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.99999'));
        expect(quote).toHaveBeenLastCalledWith(expect.objectContaining({ feePerKb: 6000 }));

        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '2' },
        });

        await waitFor(() => expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.99998'));
        expect(quote).toHaveBeenLastCalledWith(expect.objectContaining({ feePerKb: 12000 }));
    });

    it('keeps token Max at the token balance and reserves native coin for the fee', async () => {
        const messaging = mount({
            nativeQuantity: '2000',
            tokens: [{ tick: 'PEPE', quantity: '123456789', divisibility: 8 }],
        });
        fireEvent.change(await screen.findByLabelText(/^Token$/), { target: { value: 'PEPE' } });
        const max = await screen.findByRole('button', { name: 'Use max available amount' });
        await waitFor(() => expect(max).toBeEnabled());
        fireEvent.click(max);

        await waitFor(() => expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('1.23456789'));
        expect(screen.getByText(/keeps the native coin separate for the network fee/)).toHaveTextContent(
            'estimated 0.000015 BTC',
        );
        expect(messaging.quoteMaxSendable).not.toHaveBeenCalled();
    });

    it('leaves the amount alone and shows a plain note when Max is below dust', async () => {
        mount({
            nativeQuantity: '1000',
            quote: vi.fn().mockResolvedValue({
                maxSats: '400',
                feeSats: '600',
                inputSats: '1000',
                otherOutputSats: '0',
                source: 'encoder-quote',
            }),
        });
        await prepareNativeMax();

        await screen.findByText(/below the 0\.00000546 BTC dust minimum/);
        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
