// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Mounts the Send form against a funded stub host so the input-gate tests can
// drive the form fields and read which compose calls leave it.

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

export const CHAIN = 'bitcoin-mainnet';
export const FROM = 'bc1qsendersendersendersendersendersendersa';
export const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

export function mountSend() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [
                { id: 'source', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
            ],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'source', address: FROM } }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 0 }],
        }),
        getAddressUtxos: vi.fn().mockResolvedValue({ utxos: [] }),
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
            decoded: { summary: 'Send', details: [], warnings: [] },
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

/** Fills the recipient and amount of a native send and waits for the form. */
export async function fillNativeSend(amount) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: amount } });
}

export function sendButton() {
    return screen.getByRole('button', { name: /^Send$/ });
}
