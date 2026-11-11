// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick, networkLocked, pickerActions }) => (
        <div>
            <span data-testid="network-lock">{networkLocked ? 'locked' : 'switchable'}</span>
            <button type="button" onClick={pickerActions[0].onSelect}>{pickerActions[0].label}</button>
            <button
                type="button"
                onClick={() => onPick({
                    id: 'change-address',
                    address: 'bc1qsendchange0000000000000000000000000',
                    publicKey: '02bb',
                    derivationPath: "m/84'/0'/0'/1/0",
                    source: 'hd',
                }, 'bitcoin-mainnet')}
            >
                Pick change address
            </button>
        </div>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendfrom000000000000000000000000000';
const CHANGE = 'bc1qsendchange0000000000000000000000000';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function mount() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [
                {
                    id: 'from-address', address: FROM, publicKey: '02aa',
                    derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
                },
                {
                    id: 'change-address', address: CHANGE, publicKey: '02bb',
                    derivationPath: "m/84'/0'/0'/1/0", source: 'hd',
                },
            ],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'from-address', address: FROM } }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 0 }],
        }),
        getAddressUtxos: vi.fn().mockResolvedValue({ utxos: [] }),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0 },
            fees: { [CHAIN]: { strategy: null, customSatsPerKb: null, rbfByDefault: false } },
            privacy: { formDraftTtlMs: 0 },
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff',
            encoding: 'OP_RETURN',
            actionString: `SEND|0|PEPE|1|${TO}`,
            version: 0,
            chainId: CHAIN,
            networkFeeSats: 1000,
            decoded: { summary: 'Send 1 PEPE', details: [], warnings: [] },
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    const messaging = new Proxy(target, {
        get(value, key) {
            if (key in value) return value[key];
            const stub = vi.fn().mockResolvedValue(null);
            value[key] = stub;
            return stub;
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Send walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return target;
}

async function openAdvanced() {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: 'PEPE' } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Advanced'));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Send change own-address picker', () => {
    it('locks the picker to the send network and composes with the picked change address', async () => {
        const messaging = mount();
        await openAdvanced();
        const field = screen.getByRole('textbox', { name: 'Change address' });
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveAttribute('placeholder', `Automatic: ${FROM}`);
        expect(screen.queryByRole('combobox', { name: 'Change address' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
        expect(screen.getByTestId('network-lock')).toHaveTextContent('locked');
        fireEvent.click(screen.getByRole('button', { name: 'Pick change address' }));
        expect(screen.getByRole('textbox', { name: 'Change address' })).toHaveValue(CHANGE);

        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            change: CHANGE,
        })));
    });

    it('offers automatic change as a picker action', async () => {
        mount();
        await openAdvanced();
        fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick change address' }));
        expect(screen.getByRole('textbox', { name: 'Change address' })).toHaveValue(CHANGE);

        fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
        fireEvent.click(screen.getByRole('button', { name: `Automatic: ${FROM}` }));
        expect(screen.getByRole('textbox', { name: 'Change address' })).toHaveValue('');
        expect(screen.getByRole('textbox', { name: 'Change address' }))
            .toHaveAttribute('placeholder', `Automatic: ${FROM}`);
    });
});
