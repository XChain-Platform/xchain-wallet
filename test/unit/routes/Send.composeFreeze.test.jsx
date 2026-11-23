// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// While the host composes a multi-recipient send the form stays mounted. The
// recipient list must refuse edits for that window, and the review that opens
// afterwards must describe the request that was composed, not the draft.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'PEPE' })}>Pick PEPE</button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const ALICE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BOB = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

const COMPOSED = {
    psbt: '70736274ff',
    encoding: 'P2SH',
    actionString: 'SEND|1|PEPE|9',
    version: 1,
    chainId: CHAIN,
    networkFeeSats: 1234,
    decoded: {
        summary: 'Send 9 PEPE',
        details: [{ label: 'Token', value: 'PEPE' }, { label: 'Amount', value: '9' }],
        warnings: [],
    },
    simulation: { deltas: [], notes: [] },
};

const BALANCES = {
    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
    tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 0 }],
};

function mount(composeForConfirm) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue(BALANCES),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm,
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            target[prop] = vi.fn().mockResolvedValue(null);
            return target[prop];
        },
    });
    const tree = (prefill) => React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'w', onBack() {}, prefill }),
    );
    const view = render(tree(null));
    messaging.rerenderWithPrefill = (prefill) => view.rerender(tree(prefill));
    return messaging;
}

async function addRow({ to, amount }) {
    fireEvent.click(await screen.findByRole('button', { name: /Add Recipient/ }));
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: to } });
    fireEvent.click(screen.getByRole('button', { name: /^Token/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pick PEPE' }));
    fireEvent.change(await screen.findByLabelText(/^Amount/, { selector: 'input' }), { target: { value: amount } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
}

async function startDelayedMultiSend() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const composeForConfirm = vi.fn(() => gate);
    const messaging = mount(composeForConfirm);
    fireEvent.click(await screen.findByRole('tab', { name: 'Multi' }));
    await addRow({ to: ALICE, amount: '4' });
    await addRow({ to: BOB, amount: '5' });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return { messaging, release };
}

afterEach(() => {
    cleanup();
    resetWalletModes();
});

describe('Send: form while the request composes', () => {
    it('refuses recipient edits, additions and Enter until the host answers', async () => {
        const { messaging, release } = await startDelayedMultiSend();
        const rowOne = screen.getByRole('button', { name: `Edit recipient 1: 4 PEPE to ${ALICE}` });

        fireEvent.click(rowOne);
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        expect(rowOne).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('group', { name: 'New recipient' })).toBeNull();
        expect(screen.queryByTestId('send-multi-editor')).toBeNull();

        // Enter is refused at the form, so no handler below it can commit a row.
        const enterNotRefused = fireEvent.keyDown(rowOne, { key: 'Enter' });
        expect(enterNotRefused).toBe(false);
        expect(screen.getByTestId('send-multi-totals')).toHaveTextContent('Total: 9 PEPE');
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);

        await act(async () => { release(COMPOSED); });
    });

    it('opens the review for the composed recipients and total', async () => {
        const { messaging, release } = await startDelayedMultiSend();
        await act(async () => { release(COMPOSED); });
        expect(await screen.findByText(/Send 9 PEPE to 2 recipients/)).toBeInTheDocument();
        expect(messaging.composeForConfirm.mock.calls[0][0].legs).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '4' },
            { to: BOB, tick: 'PEPE', amount: '5' },
        ]);
    });

    it('keeps the review on the composed request when a prefill changes the draft mid-compose', async () => {
        // A prefill reaches the draft through props, not through a form event,
        // so the form's input guards cannot stop it. Only the frozen request
        // keeps the review describing what compose was asked to build.
        const { messaging, release } = await startDelayedMultiSend();
        await act(async () => { messaging.rerenderWithPrefill({ chainId: CHAIN, tick: 'RARE' }); });
        await act(async () => { release(COMPOSED); });
        expect(await screen.findByText(/Send 9 PEPE to 2 recipients/)).toBeInTheDocument();
        expect(screen.queryByText(/RARE/)).toBeNull();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps a single send review on the composed asset when a prefill changes the draft mid-compose', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const messaging = mount(vi.fn(() => gate));
        await act(async () => { messaging.rerenderWithPrefill({ chainId: CHAIN, tick: 'PEPE' }); });
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: ALICE } });
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '9' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0]).toMatchObject({ tick: 'PEPE', amount: '9' });

        await act(async () => { messaging.rerenderWithPrefill({ chainId: CHAIN, tick: 'RARE' }); });
        await act(async () => { release(COMPOSED); });
        const review = await screen.findByTestId('confirm-modal');
        expect(review).toHaveTextContent(/Send 9 PEPE to/);
        expect(review).not.toHaveTextContent(/RARE/);
        // The sentence follows the decode; the asset icon follows the form's
        // ticker, so it is where a live draft would show through.
        expect(within(review).getByText(/^P$/)).toBeInTheDocument();
        expect(within(review).queryByText(/^R$/)).toBeNull();
    });
});
