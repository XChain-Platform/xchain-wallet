// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const CHANGE = 'bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3w7nf4f';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const UTXO = {
    txid: '11'.repeat(32),
    vout: 0,
    value: 100000000,
    scriptPubKey: '0014aa',
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function quoteFor(maxSats) {
    return {
        maxSats,
        feeSats: '1000',
        inputSats: '100000000',
        otherOutputSats: '0',
        source: 'encoder-quote',
    };
}

function mount({ quote = vi.fn().mockResolvedValue(quoteFor('99999000')) } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [
                {
                    id: 'address-1',
                    address: FROM,
                    publicKey: '02ab',
                    derivationPath: "m/84'/0'/0'/0/0",
                    source: 'hd',
                    signerId: 'signer-7',
                },
                {
                    id: 'change-1',
                    address: CHANGE,
                    publicKey: '02cd',
                    derivationPath: "m/84'/0'/0'/1/0",
                    source: 'hd',
                    signerId: 'signer-7',
                },
            ],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_ID]: { id: 'address-1', address: FROM },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getAddressUtxos: vi.fn().mockResolvedValue({ utxos: [UTXO] }),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0 },
            fees: { [CHAIN_ID]: { strategy: 'normal', rbfByDefault: true } },
            privacy: { formDraftTtlMs: 0 },
        }),
        estimateFee: vi.fn().mockResolvedValue(null),
        quoteMaxSendable: quote,
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff',
            encoding: 'P2SH',
            actionString: '',
            version: null,
            chainId: CHAIN_ID,
            networkFeeSats: 1000,
            decoded: { summary: 'Send BTC', details: [], warnings: [] },
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
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Send walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function enterDestination() {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
}

async function useMax() {
    const max = await screen.findByRole('button', { name: 'Use max available amount' });
    await waitFor(() => expect(max).toBeEnabled());
    fireEvent.click(max);
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Send Max quote agreement', () => {
    it('quotes and composes with the same source, fee, RBF, change, and UTXOs', async () => {
        const quote = vi.fn().mockResolvedValue(quoteFor('99999000'));
        const messaging = mount({ quote });
        await enterDestination();
        fireEvent.click(screen.getByText('Advanced'));
        await waitFor(() => expect(screen.getByLabelText('Coin control enabled')).toBeEnabled());
        fireEvent.click(screen.getByLabelText('Coin control enabled'));
        fireEvent.click(screen.getByLabelText(/1 BTC/));
        fireEvent.change(screen.getByLabelText('Change address'), {
            target: { value: 'change-1' },
        });

        await useMax();
        await waitFor(() => expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.99999'));
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        const quoted = quote.mock.calls.at(-1)[0];
        const composed = messaging.composeForConfirm.mock.calls[0][0];
        expect(quoted.from).toEqual({
            address: FROM,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            addressId: 'address-1',
            source: 'hd',
            signerId: 'signer-7',
        });
        expect(composed).toMatchObject({
            from: quoted.from,
            rbf: quoted.rbf,
            change: quoted.change,
            utxos: quoted.utxos,
            feePerKb: quoted.feePerKb,
        });
        expect(quoted).toMatchObject({
            rbf: true,
            change: CHANGE,
            utxos: [UTXO],
            feePerKb: 6000,
        });
    });

    it.each([
        ['resolves null', () => vi.fn().mockResolvedValue(null)],
        ['throws', () => vi.fn(async () => { throw new Error('quote unavailable'); })],
        ['returns negative maxSats', () => vi.fn().mockResolvedValue(quoteFor('-1'))],
        ['returns non-string maxSats', () => vi.fn().mockResolvedValue(quoteFor(99999000))],
    ])('falls back to the static estimate when the quote %s', async (_label, makeQuote) => {
        mount({ quote: makeQuote() });
        await enterDestination();
        await useMax();

        const amount = screen.getByLabelText(/^Amount \(/);
        await waitFor(() => expect(amount).toHaveValue('0.999985'));
        expect(amount).toBeEnabled();
        expect(screen.getByRole('button', { name: /^Send$/ })).toBeEnabled();
    });

    it('ignores a stale quote that resolves after a newer fee quote', async () => {
        const slow = deferred();
        const fast = deferred();
        const quote = vi.fn()
            .mockImplementationOnce(() => slow.promise)
            .mockImplementationOnce(() => fast.promise);
        mount({ quote });
        await enterDestination();
        await useMax();
        await waitFor(() => expect(quote).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '2' },
        });
        await waitFor(() => expect(quote).toHaveBeenCalledTimes(2));
        await act(async () => {
            fast.resolve(quoteFor('99998000'));
            await fast.promise;
        });
        await waitFor(() => expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.99998'));

        await act(async () => {
            slow.resolve(quoteFor('99999000'));
            await slow.promise;
        });
        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('0.99998');
        expect(quote.mock.calls[0][0].feePerKb).toBe(6000);
        expect(quote.mock.calls[1][0].feePerKb).toBe(12000);
    });
});
