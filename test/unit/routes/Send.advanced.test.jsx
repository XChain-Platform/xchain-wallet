// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { MAX_MEMO_LENGTH } from '../../../packages/core/src/shared/utils/memoLimit.js';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const CHANGE = 'bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3w7nf4f';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const UTXOS = [
    { txid: '11'.repeat(32), vout: 0, value: 100000, scriptPubKey: '0014aa' },
    { txid: '22'.repeat(32), vout: 1, value: 200000, scriptPubKey: '0014bb' },
    { txid: '33'.repeat(32), vout: 2, value: 500, scriptPubKey: '0014cc' },
];

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [
                { id: 'source', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
                { id: 'change', address: CHANGE, publicKey: '02cd', derivationPath: "m/84'/0'/0'/0/1", source: 'hd' },
            ],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'source', address: FROM } }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 0 }],
        }),
        getAddressUtxos: vi.fn().mockResolvedValue({ utxos: UTXOS }),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0 },
            fees: { [CHAIN]: { strategy: null, customSatsPerKb: null, rbfByDefault: true } },
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff',
            encoding: 'OP_RETURN',
            actionString: 'SEND|0|PEPE|1|' + TO,
            version: 0,
            chainId: CHAIN,
            networkFeeSats: 1000,
            decoded: { summary: 'Send 1 PEPE', details: [], warnings: [] },
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

async function fillSend() {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: 'PEPE' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Advanced'));
}

afterEach(() => cleanup());

describe('Send advanced choices', () => {
    it('summarizes bulk-selected inputs, marks dust, and clears the selection', async () => {
        mount();
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.001' } });
        fireEvent.click(screen.getByText('Advanced'));
        await waitFor(() => expect(screen.getByLabelText('Coin control enabled')).not.toBeDisabled());
        fireEvent.click(screen.getByLabelText('Coin control enabled'));

        expect(screen.getByText('Dust')).toHaveAttribute(
            'title',
            'Below the 546 sat dust threshold',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
        expect(screen.getByText('0.003005 BTC')).toBeInTheDocument();
        expect(screen.getByText('0.00199 BTC')).toBeInTheDocument();
        expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(3);

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(within(screen.getByLabelText('Coin control summary')).getAllByText('0 BTC')).toHaveLength(2);
        expect(screen.getAllByRole('checkbox', { checked: false })).toHaveLength(3);
    });

    it('counts memo UTF-8 bytes and refuses the network-invalid length before compose', async () => {
        const messaging = mount();
        await fillSend();
        const memo = screen.getByLabelText('Memo (optional)');
        fireEvent.change(memo, { target: { value: `${'é'.repeat(123)}📦a` } });

        expect(screen.getByText(`${MAX_MEMO_LENGTH + 1} / ${MAX_MEMO_LENGTH} bytes`, { exact: false }))
            .toBeInTheDocument();
        expect(screen.getByText(/network accepts at most 250/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('passes a valid accented and emoji memo to compose unchanged', async () => {
        const messaging = mount();
        await fillSend();
        const memo = 'café 📦';
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: memo } });

        expect(screen.getByText(`10 / ${MAX_MEMO_LENGTH} bytes`, { exact: false }))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].memo).toBe(memo);
    });

    it('composes selected inputs and change, then repeats every advanced choice on review', async () => {
        const messaging = mount();
        await fillSend();
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'invoice 7' } });
        await waitFor(() => expect(screen.getByLabelText('Coin control enabled')).not.toBeDisabled());
        fireEvent.click(screen.getByLabelText('Coin control enabled'));
        fireEvent.click(screen.getByLabelText(/0\.001 BTC/));
        fireEvent.change(screen.getByLabelText('Change address'), { target: { value: 'change' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0]).toMatchObject({
            memo: 'invoice 7',
            rbf: true,
            change: CHANGE,
            utxos: [UTXOS[0]],
        });

        const review = await screen.findByLabelText('Advanced send choices');
        expect(within(review).getByText('invoice 7')).toBeInTheDocument();
        expect(within(review).getByText('Allowed')).toBeInTheDocument();
        expect(within(review).getByText('1 selected input')).toBeInTheDocument();
        expect(within(review).getByText(CHANGE)).toBeInTheDocument();
    });
});
