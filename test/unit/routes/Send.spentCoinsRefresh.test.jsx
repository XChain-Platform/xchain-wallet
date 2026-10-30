// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A send refused because another send from the wallet holds its coins leaves
// the form in place. The balance line under Amount and Max then have to read
// the address again: the figure they showed was read before the other send
// took those coins, and offering it again leads straight to the same refusal.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const LTC = 'litecoin-mainnet';
const LTC_FROM = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';
const LTC_TO = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';

const SPENT_HERE = Object.assign(
    new Error('One of the coins this transaction spends has already been used. Start over to build a new one.'),
    { name: 'InputsAlreadySpentError' },
);
const SPENT_ON_NETWORK = Object.assign(
    new Error('broadcast failed (phase1): txn-mempool-conflict'),
    { name: 'BroadcastFailedPermanentError' },
);

function mount(sendError) {
    const balances = [
        { native: { tick: 'LTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
        { native: { tick: 'LTC', quantity: '40000000', divisibility: 8 }, tokens: [] },
    ];
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [LTC]: [{ id: 'addr-ltc', address: LTC_FROM, publicKey: '02ab', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [LTC]: { id: 'addr-ltc', address: LTC_FROM } }),
        // The first reads see the whole balance; once the other send holds its
        // coins, a fresh read of the address sees what is left.
        getAddressBalances: vi.fn(async () => balances[0]),
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 }, activeNetwork: 'mainnet' }),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn(async () => {
            base.getAddressBalances.mockImplementation(async () => balances[1]);
            throw sendError;
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
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
    render(React.createElement(MessagingProvider, { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'w', onBack() {}, prefill: { chainId: LTC } })));
    return messaging;
}

async function sendAndRefuse(messaging) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: LTC_TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
    await screen.findByText(/^1 LTC available/);
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('Send after a refusal over coins another send holds', () => {
    it('reads the balance again when the wallet refused the send before signing', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mount(SPENT_HERE);
        await sendAndRefuse(messaging);

        expect(await screen.findByText(/already been used/)).toBeTruthy();
        expect(await screen.findByText(/^0\.4 LTC available/)).toBeTruthy();
    });

    it('reads the balance again when the node refused the send over spent coins', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mount(SPENT_ON_NETWORK);
        await sendAndRefuse(messaging);

        expect(await screen.findByText(/already used by another transaction/)).toBeTruthy();
        expect(await screen.findByText(/^0\.4 LTC available/)).toBeTruthy();
    });
});
