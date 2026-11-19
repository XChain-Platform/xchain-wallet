// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A recipient's amount belongs to the token it was typed for. Picking another
// token for a Multi row after typing its amount, or writing an Advanced line
// in a token with fewer places, can leave an amount with more decimal places
// than the token has. The network refuses such a SEND after the fee is spent,
// so the row is refused when it is added, and the line when Send is pressed.

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

/** Open Multi once the source balances (which carry each token's places) have loaded. */
async function openMulti() {
    await screen.findByText(/BTC available/);
    fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
}

async function startRow(to, tick, amount) {
    fireEvent.click(await screen.findByRole('button', { name: /Add Recipient/ }));
    fireEvent.change(screen.getByLabelText(/^To$/), { target: { value: to } });
    fireEvent.click(screen.getByRole('button', { name: /^Token/ }));
    fireEvent.click(await screen.findByRole('button', { name: `Pick ${tick}` }));
    fireEvent.change(await screen.findByLabelText(/^Amount/, { selector: 'input' }), { target: { value: amount } });
}

describe('Send: a recipient amount follows its token decimal places', () => {
    it('refuses a Multi row whose amount has more places than the token picked after it', async () => {
        mount();
        await openMulti();
        await startRow(BOB, 'XCP', '0.5');
        // The token changes after the amount was typed for XCP.
        fireEvent.click(screen.getByRole('button', { name: /^Token/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick PEPE' }));
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        // The amount field states the token's places; the row is not added.
        expect(screen.getAllByText(/at most 0 decimal places|PEPE has no decimal places/).length).toBeGreaterThan(0);
        expect(screen.queryAllByTestId('send-multi-row')).toHaveLength(0);
    });

    it('adds and composes a row amount within its token places', async () => {
        const messaging = mount();
        await openMulti();
        await startRow(ALICE, 'PEPE', '7');
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        await startRow(BOB, 'XCP', '0.5');
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs[1]).toEqual({ to: BOB, tick: 'XCP', amount: '0.5' });
    });

    it('names an Advanced line whose amount has more places than its token', async () => {
        const messaging = mount();
        await screen.findByText(/BTC available/);
        fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
        fireEvent.change(screen.getByLabelText('Recipients'), {
            target: { value: `${ALICE},XCP,0.5\n${BOB},PEPE,1.5` },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(screen.getAllByText(/Line 2: PEPE has no decimal places/).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
