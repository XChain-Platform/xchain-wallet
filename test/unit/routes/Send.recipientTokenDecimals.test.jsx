// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An added recipient's amount belongs to the token it was typed for. Picking
// another token for that row, or turning per-recipient tokens off so the row
// takes the first row's token, can leave an amount with more decimal places
// than the token has. The network refuses such a SEND after the fee is spent,
// so the form clears the row amount on a token change and refuses an amount
// past the row token's places before composing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'XCP' })}>Pick XCP</button>
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'PEPE' })}>Pick PEPE</button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
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

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [
                { tick: 'PEPE', quantity: '1000', divisibility: 0 },
                { tick: 'XCP', quantity: '100000000000', divisibility: 8 },
            ],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
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
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

async function fillFirst(tick, amount) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: ALICE } });
    fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: tick } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: amount } });
    // The row checks read the source balances, which load after the form settles.
    await screen.findByText(new RegExp(tick + ' available'));
}

function pickRowToken(tick) {
    fireEvent.click(screen.getByRole('button', { name: /Recipient 2 token/ }));
    fireEvent.click(screen.getByRole('button', { name: `Pick ${tick}` }));
}

function rowAmount() {
    return /** @type {HTMLInputElement} */ (screen.getByLabelText('Recipient 2 amount'));
}

describe('Send: an added recipient amount follows its token decimal places', () => {
    it('clears the row amount when another token is picked for the row', async () => {
        const messaging = mount();
        await fillFirst('PEPE', '7');
        fireEvent.click(await screen.findByRole('button', { name: /Add recipient/ }));
        fireEvent.change(screen.getByLabelText('Recipient 2 address'), { target: { value: BOB } });
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));
        pickRowToken('XCP');
        fireEvent.change(rowAmount(), { target: { value: '0.5' } });
        pickRowToken('PEPE');
        expect(rowAmount().value).toBe('');
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps the row amount when the same token is picked again', async () => {
        mount();
        await fillFirst('PEPE', '7');
        fireEvent.click(await screen.findByRole('button', { name: /Add recipient/ }));
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));
        pickRowToken('XCP');
        fireEvent.change(rowAmount(), { target: { value: '0.5' } });
        pickRowToken('XCP');
        expect(rowAmount().value).toBe('0.5');
    });

    it('refuses a row amount past its token places once the row takes the first token', async () => {
        const messaging = mount();
        await fillFirst('PEPE', '7');
        fireEvent.click(await screen.findByRole('button', { name: /Add recipient/ }));
        fireEvent.change(screen.getByLabelText('Recipient 2 address'), { target: { value: BOB } });
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));
        pickRowToken('XCP');
        fireEvent.change(rowAmount(), { target: { value: '0.5' } });
        // Turning per-recipient tokens off sends the row in PEPE, which has no decimal places.
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(screen.getAllByText(/Recipient 2: amount can have at most 0 decimal places/).length).toBeGreaterThan(0);
    });

    it('clears a row that inherits the first token when that token changes', async () => {
        mount();
        await fillFirst('XCP', '1');
        fireEvent.click(await screen.findByRole('button', { name: /Add recipient/ }));
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));
        // The row has no token of its own, so it sends the first row's XCP.
        fireEvent.change(rowAmount(), { target: { value: '0.5' } });
        fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: 'PEPE' } });
        expect(rowAmount().value).toBe('');
    });

    it('still composes a row amount within its token places', async () => {
        const messaging = mount();
        await fillFirst('PEPE', '7');
        fireEvent.click(await screen.findByRole('button', { name: /Add recipient/ }));
        fireEvent.change(screen.getByLabelText('Recipient 2 address'), { target: { value: BOB } });
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));
        pickRowToken('XCP');
        fireEvent.change(rowAmount(), { target: { value: '0.5' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs[1]).toEqual({ to: BOB, tick: 'XCP', amount: '0.5' });
    });
});
