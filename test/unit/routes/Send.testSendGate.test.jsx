// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The §21.4 test-send gate must reach the SCREEN, not just the memo.
//
// The gate had been correct for a year and still bought zero protection: its
// banner and its submit-disable both lived in the legacy `stage === 'review'`
// branch, and rerouted every non-watcher send straight from the compose
// form into the confirm modal. That branch stopped rendering, so a first-ever
// send of any size sailed through. The pre-existing smoke for this feature is a
// source grep, which still matched perfectly while the feature was dead.
//
// These drive the real form: type a large native send to a never-seen address
// with a threshold configured, and assert the user is actually stopped, i.e.
// nothing crosses the messaging boundary until the warning is acknowledged.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
// Real bech32 destinations: the form decodes these, so a made-up string
// would be rejected as an invalid address before the gate is ever consulted.
const NOVEL = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: FROM,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function mount({ thresholdSats = 100000, contacts = [], history = [] } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: thresholdSats },
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue(contacts),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
    };
    // Send reaches for a wide messaging surface (fee tiers, prices,
    // reservations). Anything this test does not care about answers empty
    // rather than throwing, so an unrelated new call cannot fail these cases.
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
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

async function fillNativeSend({ to = NOVEL, amount = '0.02' } = {}) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: to } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: amount } });
}

const sendButton = () => screen.getByRole('button', { name: /^Send$/ });

afterEach(() => cleanup());

describe('Send: test-send gate reaches the screen', () => {
    it('warns before a large first send to a never-seen address', async () => {
        mount({ thresholdSats: 1 });
        await fillNativeSend();
        expect(await screen.findByText(/First send to this address/i)).toBeInTheDocument();
    });

    it('[REGRESSION] refuses to compose while the warning stands', async () => {
        const messaging = mount({ thresholdSats: 1 });
        await fillNativeSend();
        await screen.findByText(/First send to this address/i);

        fireEvent.click(sendButton());
        // Give the compose path a turn of the event loop to prove it is not
        // merely slow: nothing may reach the host while the gate is up.
        await new Promise((r) => { setTimeout(r, 0); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes once the user acknowledges the address', async () => {
        const messaging = mount({ thresholdSats: 1 });
        await fillNativeSend();
        fireEvent.click(await screen.findByRole('button', { name: /verified/i }));

        await waitFor(() => {
            expect(screen.queryByText(/First send to this address/i)).toBeNull();
        });
        fireEvent.click(sendButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });

    it('"Send a small test first" drops the amount to 1% and clears the gate', async () => {
        mount({ thresholdSats: 100000 });
        await fillNativeSend({ amount: '0.02' });
        fireEvent.click(await screen.findByRole('button', { name: /small test/i }));

        const amountField = await screen.findByLabelText(/^Amount \(/);
        await waitFor(() => expect(amountField.value).toBe('0.0002'));
        // 20,000 sats now sits under the 100,000-sat threshold, so the
        // warning must retire on its own.
        expect(screen.queryByText(/First send to this address/i)).toBeNull();
    });

    it('stays quiet for an amount under the threshold', async () => {
        const messaging = mount({ thresholdSats: 100000000 });
        await fillNativeSend({ amount: '0.02' });
        fireEvent.click(sendButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(screen.queryByText(/First send to this address/i)).toBeNull();
    });

    it('stays quiet for an address the user has already sent to', async () => {
        const messaging = mount({
            thresholdSats: 1,
            history: [{ action: 'SEND', destination: NOVEL }],
        });
        await fillNativeSend();
        fireEvent.click(sendButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(screen.queryByText(/First send to this address/i)).toBeNull();
    });
});
