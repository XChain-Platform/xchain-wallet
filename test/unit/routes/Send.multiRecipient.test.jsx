// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-52 through the real Send form: adding a recipient must change the PAYLOAD,
// not just the screen.
//
// These drive the component the way a user does (type, click "+ Add recipient",
// submit) and assert what crosses the messaging boundary, because that is the
// only place the multi-leg send becomes real. The two refusals are here for the
// same reason: a form that renders a warning but still submits would compose a
// transaction the chain rejects, or worse, one it accepts wrongly.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
// Valid mainnet bech32 destinations: the form decodes these for real, so a
// made-up string would fail address validation before the payload is built.
const ALICE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BOB = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: FROM,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function mount({ gated = false } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 0 }],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue(
            gated ? { state: 'ready', groups: [{ keyHash: 'aa', haveKey: true }] } : { state: 'ungated' },
        ),
        buildSendPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    // Send reaches for a wide messaging surface (history, fee tiers, prices,
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

const addRecipient = () => screen.findByRole('button', { name: /Add recipient/ });

/** Fill the first recipient (the ordinary single-send fields). */
async function fillFirst({ tick = 'PEPE', amount = '7', to = ALICE } = {}) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: to } });
    fireEvent.change(await screen.findByLabelText(/^Token$/), { target: { value: tick } });
    // The primary amount label carries its unit ("Amount (PEPE)").
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: amount } });
}

/** Fill one added recipient row (1-based on the extra rows: row 1 = Recipient 2). */
async function fillRow(n, { to, amount, tick } = {}) {
    if (to !== undefined) {
        fireEvent.change(await screen.findByLabelText(`Recipient ${n + 1} address`), { target: { value: to } });
    }
    if (tick !== undefined) {
        fireEvent.change(await screen.findByLabelText(`Recipient ${n + 1} token`), { target: { value: tick } });
    }
    if (amount !== undefined) {
        fireEvent.change(await screen.findByLabelText(`Recipient ${n + 1} amount`), { target: { value: amount } });
    }
}

afterEach(() => cleanup());

describe('Send: multi-recipient (PC-52)', () => {
    it('offers a second recipient for a token send', async () => {
        mount();
        await fillFirst();
        expect(await addRecipient()).toBeInTheDocument();
    });

    it('sends one leg per recipient, with each amount and address intact', async () => {
        const messaging = mount();
        await fillFirst({ amount: '7' });
        fireEvent.click(await addRecipient());
        await fillRow(1, { to: BOB, amount: '3' });

        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const payload = messaging.composeForConfirm.mock.calls[0][0];
        expect(payload.legs).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '7' },
            { to: BOB, tick: 'PEPE', amount: '3' },
        ]);
    });

    it('[REGRESSION] a single-recipient send still carries NO legs at all', async () => {
        const messaging = mount();
        await fillFirst();
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const payload = messaging.composeForConfirm.mock.calls[0][0];
        expect(payload.legs).toBeUndefined();
        expect(payload).toMatchObject({ to: ALICE, tick: 'PEPE', amount: '7' });
    });

    it('removing the added recipient returns to a single-leg payload', async () => {
        const messaging = mount();
        await fillFirst();
        fireEvent.click(await addRecipient());
        fireEvent.click(await screen.findByRole('button', { name: /Remove recipient 2/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs).toBeUndefined();
    });

    it('blocks an empty added recipient instead of composing a partial send', async () => {
        const messaging = mount();
        await fillFirst();
        fireEvent.click(await addRecipient());
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(await screen.findByText(/Recipient 2: address is required/)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('validates the added recipient address like the first one', async () => {
        const messaging = mount();
        await fillFirst();
        fireEvent.click(await addRecipient());
        await fillRow(1, { to: 'bc1qnotarealaddressatall', amount: '3' });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await screen.findByText(/Recipient 2:/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('carries a per-recipient token when the switch is on (the multi-tick case)', async () => {
        const messaging = mount();
        await fillFirst();
        fireEvent.click(await addRecipient());
        fireEvent.click(screen.getByRole('switch', { name: /Different token per recipient/ }));
        await fillRow(1, { to: BOB, tick: 'DANK', amount: '3' });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '7' },
            { to: BOB, tick: 'DANK', amount: '3' },
        ]);
    });

    it('does not offer a second recipient for the native coin', async () => {
        mount();
        await fillFirst({ tick: 'BTC', amount: '0.5' });
        await waitFor(() => expect(screen.queryByRole('button', { name: /Add recipient/ })).toBeNull());
    });

    it('refuses to submit when the token is switched to the coin after rows were added', async () => {
        const messaging = mount();
        await fillFirst();
        fireEvent.click(await addRecipient());
        await fillRow(1, { to: BOB, amount: '3' });
        // The rows are KEPT (the typed addresses are not thrown away) and the
        // send is blocked with the reason.
        fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: 'BTC' } });
        expect(await screen.findByText(/BTC can only be sent to one recipient/)).toBeInTheDocument();
        expect(await screen.findByLabelText('Recipient 2 address')).toHaveValue(BOB);
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).not.toHaveBeenCalled());
    });

    it('refuses a multi-recipient send of a gated token (each recipient needs a key handoff)', async () => {
        const messaging = mount({ gated: true });
        await fillFirst({ tick: 'GATED' });
        await screen.findByText(/This token has gated content/);
        fireEvent.click(await addRecipient());
        await fillRow(1, { to: BOB, amount: '3' });
        expect(await screen.findByText(/each recipient needs their own/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).not.toHaveBeenCalled());
    });
});
