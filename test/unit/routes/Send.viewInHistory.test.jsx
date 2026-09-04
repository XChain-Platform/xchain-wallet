// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.4: the Send success card gains a "View in history" action landing on
// the merged entry, which the wallet builds from its own PendingTx record
// the instant broadcast succeeds - before the network has necessarily
// reported it. These drive the REAL Send component end to end (fill ->
// review's single-encode confirm modal -> Approve -> broadcast) rather than
// poking the 'done' stage directly, so the assertion covers the actual path
// a user takes to reach the card, not a shortcut around it.
//
// Terminology per spec §7: "pending" in copy the user reads, never
// "confirmed"/"accepted" about a transaction that has only been broadcast.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function mount({ onViewHistory } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
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
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 } }),
        // Unlocked signer: the confirm screen skips the password field so
        // the drive can go straight from filled-form to Approve.
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockResolvedValue({ txid: TXID }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    // Send reaches for a wide messaging surface (fee tiers, prices, the
    // single-encode confirm pipeline's reserve/session plumbing). Anything
    // this test does not care about answers empty rather than throwing.
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
            React.createElement(Send, { walletId: 'w', onBack() {}, onViewHistory }),
        ),
    );
    return { messaging };
}

async function driveToBroadcastDone(messaging) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    // Single-encode confirm pipeline: compose runs pre-open, the modal opens
    // once pre-flight (best-effort here) lands on 'ready', enabling Approve.
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    fireEvent.click(approve);

    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());
    return screen.findByRole('heading', { name: /Broadcast pending/i });
}

afterEach(() => cleanup());

describe('Send success card: "View in history" (M2.4)', () => {
    it('offers the action after broadcast and names the wait honestly', async () => {
        const onViewHistory = vi.fn();
        const { messaging } = mount({ onViewHistory });
        await driveToBroadcastDone(messaging);

        const button = screen.getByRole('button', { name: /View in history/i });
        expect(button).toBeInTheDocument();

        // Pre-validation honesty (§7): a broadcast is not a network sighting.
        // The copy must say the merged row can still read "awaiting network"
        // for a while, and must not claim the tx is confirmed or accepted.
        const hint = screen.getByText(/awaiting network/i);
        expect(hint.textContent).toMatch(/up to a minute/i);
        expect(hint.textContent).not.toMatch(/confirmed|accepted/i);
    });

    it('navigates with the transaction identity, matching History\'s initialFocus shape', async () => {
        const onViewHistory = vi.fn();
        const { messaging } = mount({ onViewHistory });
        await driveToBroadcastDone(messaging);

        fireEvent.click(screen.getByRole('button', { name: /View in history/i }));

        expect(onViewHistory).toHaveBeenCalledTimes(1);
        expect(onViewHistory).toHaveBeenCalledWith({ chainId: CHAIN_ID, txHash: TXID });
    });

    it('hides the action and its hint when the caller wires no navigation', async () => {
        const { messaging } = mount({ onViewHistory: undefined });
        await driveToBroadcastDone(messaging);

        expect(screen.queryByRole('button', { name: /View in history/i })).toBeNull();
        expect(screen.queryByText(/awaiting network/i)).toBeNull();
        // The rest of the card is untouched: still exactly the two
        // pre-existing actions.
        expect(screen.getByRole('button', { name: /^Send another$/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Done$/ })).toBeInTheDocument();
    });
});
