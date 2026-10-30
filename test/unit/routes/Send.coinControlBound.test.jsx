// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A tracker answer with thousands of inputs. Measured in the extension side
// panel: 100,000 rows rendered 900,000 nodes and held the main thread for 7.8
// and 9.8 seconds when coin control opened. The list is bounded, says how
// many it shows, and Select all still takes every input.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { COIN_CONTROL_ROW_LIMIT, Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const CHANGE = 'bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3w7nf4f';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const COUNT = 2500;
const UTXOS = Array.from({ length: COUNT }, (_, i) => ({
    txid: i.toString(16).padStart(64, '0'), vout: 0, value: 1000, scriptPubKey: '0014aa',
}));

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

afterEach(() => cleanup());

describe('coin control over a very large input set', () => {
    it('lists a bounded window, says so, and Select all still takes every input', async () => {
        mount();
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.001' } });
        fireEvent.click(screen.getByText('Advanced'));
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Coin control enabled' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('switch', { name: 'Coin control enabled' }));

        expect(screen.getAllByRole('checkbox')).toHaveLength(COIN_CONTROL_ROW_LIMIT);
        expect(screen.getByText(`Showing ${COIN_CONTROL_ROW_LIMIT} of ${COUNT} inputs. Select all includes every input.`)).toBeInTheDocument();
        expect(screen.getByText(`${COUNT} available`)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
        expect(within(screen.getByLabelText('Coin control summary')).getByText('0.025 BTC')).toBeInTheDocument();
    });
});
