// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A send held in its Undo window outlives the Send screen: a wallet or account
// switch (on this surface or another), a network change or a route change
// remounts Send while the host still counts down. The countdown moves to the
// app toast stack so Cancel stays in reach, and the outcome is stated when the
// held send settles. Drives the real Send component through the confirm modal.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost, useClearToastsOnLock } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// Stands in for a shell App: the session state drives the lock-time toast clear.
function SessionShell({ session, children }) {
    useClearToastsOnLock(session);
    return children;
}

function mount() {
    const held = deferred();
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
                id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0, undoSendEnabled: true, undoSendSeconds: 10 },
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        // The host holds the signed send until its window ends or Cancel lands.
        sendToken: vi.fn(() => held.promise),
        sendHoldCancel: vi.fn().mockResolvedValue({ cancelled: true }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 102 }),
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
    const tree = (showSend, session = 'unlocked') => React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(
            ToastHost,
            null,
            React.createElement(
                SessionShell,
                { session },
                showSend
                    ? React.createElement(Send, { key: 'wallet-a', walletId: 'wallet-a', onBack() {} })
                    : React.createElement('p', null, session === 'locked' ? 'Locked screen' : 'Other wallet home'),
            ),
        ),
    );
    const view = render(tree(true));
    return {
        messaging,
        held,
        leaveSend: () => view.rerender(tree(false)),
        lock: () => view.rerender(tree(false, 'locked')),
    };
}

async function approveHeldSend(messaging) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());
    await screen.findByText(/^Sending in \d+ s$/);
    return messaging.sendToken.mock.calls[0][0].holdId;
}

afterEach(() => cleanup());

describe('Send: a held send keeps its Undo when the screen goes away', () => {
    it('moves the countdown to a toast whose Cancel stops the held send', async () => {
        const { messaging, held, leaveSend } = mount();
        const holdId = await approveHeldSend(messaging);
        expect(holdId).toMatch(/^undo-send:/);

        leaveSend();
        expect(screen.getByText('Other wallet home')).toBeInTheDocument();
        expect(await screen.findByText(/Your send goes out in \d+ s/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(messaging.sendHoldCancel).toHaveBeenCalledWith(holdId));

        await act(async () => {
            held.reject(Object.assign(new Error('send hold cancelled'), { name: 'SendHoldCancelledError' }));
        });
        expect(await screen.findByText('Send cancelled. Nothing was broadcast.')).toBeInTheDocument();
        expect(screen.queryByText(/Your send goes out in/)).toBeNull();
    });

    it('states the broadcast when the held send goes out after the screen is gone', async () => {
        const { messaging, held, leaveSend } = mount();
        await approveHeldSend(messaging);
        leaveSend();
        await screen.findByText(/Your send goes out in \d+ s/);

        await act(async () => { held.resolve({ txid: TXID }); });
        expect(await screen.findByText('Your held send is broadcast. It shows in History.')).toBeInTheDocument();
        expect(screen.queryByText(/Your send goes out in/)).toBeNull();
        expect(messaging.sendHoldCancel).not.toHaveBeenCalled();
    });

    it('keeps the countdown and the outcome off the lock screen when a lock removes Send', async () => {
        const { messaging, held, lock } = mount();
        await approveHeldSend(messaging);
        lock();
        expect(screen.getByText('Locked screen')).toBeInTheDocument();
        expect(screen.queryByText(/Your send goes out in/)).toBeNull();

        await act(async () => { held.reject(Object.assign(new Error('wallet is locked'), { name: 'VaultClosedError' })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(screen.queryByText(/Your held send/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('says so when the held send fails after the screen is gone', async () => {
        const { messaging, held, leaveSend } = mount();
        await approveHeldSend(messaging);
        leaveSend();
        await screen.findByText(/Your send goes out in \d+ s/);

        await act(async () => { held.reject(new Error('node unreachable')); });
        expect(await screen.findByText('Your held send did not finish. Check History before you send it again.')).toBeInTheDocument();
    });
});
