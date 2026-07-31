// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the Send form must refuse a below-dust NATIVE amount before composing.
//
// Measured on BTC regtest before the fix: a 109-sat send (floor 546) filled the
// form, composed, opened the confirm screen with Approve enabled, got SIGNED, and
// was refused by the node at relay. The only thing the user was then told was
// "the network rejected this transaction", which names neither the amount nor the
// floor, so retrying the same amount is the obvious next move. No money is lost
// (a dust output is non-standard, so the transaction never enters a mempool and
// no miner fee is paid), but a signature was produced for a transaction that can
// never confirm.
//
// These drive the real form and assert on the messaging boundary: nothing may
// reach `composeForConfirm` for a below-dust amount, and the sentence shown must
// name the minimum. The per-coin cases exist because the floor is NOT one number
// (BTC 546, LTC 5460, DOGE 100000) and a guard hardcoded to Bitcoin's would let
// a 600-sat Litecoin send through while blocking a legal Dogecoin one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

/**
 * Per-chain fixtures. Destinations and sources are real addresses for their
 * network (the form decodes them, so a made-up string is rejected as invalid
 * long before the dust check is consulted).
 */
const CHAINS = {
    bitcoin: {
        chainId: 'bitcoin-mainnet',
        ticker: 'BTC',
        floorSats: 546,
        minimum: '0.00000546',
        from: 'bc1qsendersendersendersendersendersendersa',
        to: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        path: "m/84'/0'/0'/0/0",
    },
    litecoin: {
        chainId: 'litecoin-mainnet',
        ticker: 'LTC',
        floorSats: 5460,
        minimum: '0.0000546',
        from: 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9',
        to: 'ltc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3nmndwj',
        path: "m/84'/2'/0'/0/0",
    },
    dogecoin: {
        chainId: 'dogecoin-mainnet',
        ticker: 'DOGE',
        floorSats: 100000,
        minimum: '0.001',
        from: 'D8FaQQWt8SJCiCGYYBAsUn8qhXxthiYBro',
        to: 'D6hLULEGDRbk86j58t5iWmeinqM6acA16V',
        path: "m/44'/3'/0'/0/0",
    },
};

function mount(coin, { tokens = [] } = {}) {
    const c = CHAINS[coin];
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [c.chainId]: [{
                id: 'addr-1',
                address: c.from,
                publicKey: '02ab',
                derivationPath: c.path,
                source: 'hd',
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: c.ticker, quantity: '100000000', divisibility: 8 },
            tokens,
        }),
        // The test-send gate is a different subject and would otherwise disable
        // the Send button underneath this one.
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 } }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    // Send reaches for a wide messaging surface (fee tiers, prices,
    // reservations). Anything this test does not care about answers empty
    // rather than throwing.
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
    return { messaging, chain: c };
}

async function fill({ to, amount, tick }) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: to } });
    if (tick) {
        fireEvent.change(await screen.findByLabelText(/^Token$/), { target: { value: tick } });
    }
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: amount } });
}

const sendButton = () => screen.getByRole('button', { name: /^Send$/ });

/** Sats -> the plain decimal string the amount field takes. */
function decimal(sats) {
    return (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

afterEach(() => cleanup());

describe('Send: below-dust amounts are refused before composing ', () => {
    it('[REGRESSION] does not compose the measured 109-sat Bitcoin send', async () => {
        const { messaging, chain } = mount('bitcoin');
        await fill({ to: chain.to, amount: '0.00000109' });

        fireEvent.click(sendButton());
        // A turn of the event loop, to prove the compose path is refused rather
        // than merely slow.
        await new Promise((r) => { setTimeout(r, 0); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('names the minimum rather than leaving the amount to guesswork', async () => {
        const { chain } = mount('bitcoin');
        await fill({ to: chain.to, amount: '0.00000109' });

        const said = await screen.findByText(/too small to send/i);
        expect(said.textContent).toContain(`${chain.minimum} ${chain.ticker}`);
        expect(said.textContent).toContain('546 sats');
    });

    it('refuses one satoshi under the floor and accepts the floor itself', async () => {
        const { messaging, chain } = mount('bitcoin');
        await fill({ to: chain.to, amount: decimal(chain.floorSats - 1) });
        await screen.findByText(/too small to send/i);
        fireEvent.click(sendButton());
        await new Promise((r) => { setTimeout(r, 0); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        // Exactly at the threshold is a LEGAL output, not a dust one, so the
        // guard must be strictly-less-than.
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), {
            target: { value: decimal(chain.floorSats) },
        });
        await waitFor(() => {
            expect(screen.queryByText(/too small to send/i)).toBeNull();
        });
        fireEvent.click(sendButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });

    it('a comfortably-above-floor amount still composes', async () => {
        const { messaging, chain } = mount('bitcoin');
        await fill({ to: chain.to, amount: '0.01' });
        expect(screen.queryByText(/too small to send/i)).toBeNull();
        fireEvent.click(sendButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });

    for (const coin of ['litecoin', 'dogecoin']) {
        it(`uses ${coin}'s own floor, not Bitcoin's`, async () => {
            const { messaging, chain } = mount(coin);
            // Above Bitcoin's 546 and below this chain's floor: the case a
            // Bitcoin-hardcoded guard would wave through.
            await fill({ to: chain.to, amount: decimal(chain.floorSats - 1) });
            const said = await screen.findByText(/too small to send/i);
            expect(said.textContent).toContain(`${chain.minimum} ${chain.ticker}`);
            fireEvent.click(sendButton());
            await new Promise((r) => { setTimeout(r, 0); });
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();

            fireEvent.change(await screen.findByLabelText(/^Amount \(/), {
                target: { value: decimal(chain.floorSats) },
            });
            await waitFor(() => {
                expect(screen.queryByText(/too small to send/i)).toBeNull();
            });
            fireEvent.click(sendButton());
            await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        });
    }

    it('leaves TOKEN amounts alone: dust is a property of a real output', async () => {
        // A token amount is written into the action, and the encoder sizes the
        // destination output itself (its own dustAmount, M-6). 109 units of a
        // token is an ordinary send and must not be caught by a coin's floor.
        const { messaging, chain } = mount('bitcoin', {
            tokens: [{ tick: 'PEPECREATURE', quantity: '500000000000', divisibility: 8 }],
        });
        await fill({ to: chain.to, amount: '0.00000109', tick: 'PEPECREATURE' });
        expect(screen.queryByText(/too small to send/i)).toBeNull();
        fireEvent.click(sendButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });
});
