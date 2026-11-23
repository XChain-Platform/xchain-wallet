// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The forms treat the host's active-address map as best-effort. When it is
// missing they pick a default source themselves, and a wallet whose addresses
// all came from a hardware device must still get one, as the host's own
// default gives it.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../../packages/core/src/shared/routes/Send.jsx';
import { DispenserForm } from '../../../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qdevicedevicedevicedevicedevicedevicede';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const DEVICE = {
    id: 'device-1', address: FROM, publicKey: '02cd', derivationPath: "m/84'/0'/0'/0/0",
    source: 'trezor', signerId: 'signer-1',
};

function deviceOnlyMessaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue({
            activeNetwork: 'mainnet', walletMode: 'full', grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0, priceDataEnabled: false },
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [DEVICE] }),
        getActiveAddresses: vi.fn().mockRejectedValue(new Error('active map unavailable')),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [],
        }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN_ID]: [] }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'available' }),
        listContacts: vi.fn().mockResolvedValue([]),
        listActions: vi.fn().mockResolvedValue(['SEND', 'DISPENSER']),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: `SEND|1|BTC|0.01|${TO}`, version: 1,
            chainId: CHAIN_ID, networkFeeSats: 1234,
            decoded: { summary: 'Send 0.01 BTC', details: [], warnings: [] },
            simulation: { deltas: [], notes: [] },
        }),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            target[property] = vi.fn().mockResolvedValue(null);
            return target[property];
        },
    });
}

function mount(element, messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{element}</ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('a hardware-only wallet with no active-address map', () => {
    it('Send defaults its source to the device address and reaches review', async () => {
        const messaging = deviceOnlyMessaging();
        mount(<Send walletId="w" onBack={() => {}} />, messaging);
        const destination = await screen.findByLabelText(/^To$/);
        fireEvent.change(destination, { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        fireEvent.submit(destination.closest('form'));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(JSON.stringify(messaging.composeForConfirm.mock.calls[0])).toContain(FROM);
        expect(screen.queryByText('Choose the address to send from.')).toBeNull();
    });

    it('a preferredSourceId form defaults its source to the device address', async () => {
        mount(<DispenserForm walletId="w" onBack={() => {}} />, deviceOnlyMessaging());
        expect((await screen.findByLabelText('From address')).value).toBe(FROM);
    });
});
