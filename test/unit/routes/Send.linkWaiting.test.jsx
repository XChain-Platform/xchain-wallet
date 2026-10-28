// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// While a payment link waits behind an approved payment, the Send result says
// so, and the release tells the shell whether the user left by Back or Done on
// that result (the link opens) or by any other route (the link is dropped).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { useDeepLinks } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const OTHER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function mount({ onHoldLinks, sendToken, onDone, linkWaiting }) {
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
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken,
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
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(
                ToastHost,
                null,
                React.createElement(Send, { walletId: 'w', onBack() {}, onDone, onHoldLinks, linkWaiting }),
            ),
        ),
    );
    return { messaging, view };
}

async function openConfirm(messaging) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    return approve;
}

afterEach(() => cleanup());

async function approveToResult(messaging) {
    const approve = await openConfirm(messaging);
    fireEvent.click(approve);
    await screen.findByRole('heading', { name: /Broadcast pending/i });
}

describe('Send result with a payment link waiting', () => {
    const WAITING = 'A payment link is waiting and opens when you leave this screen.';

    it('shows one quiet line on the result only while a link waits', async () => {
        const sendToken = vi.fn().mockResolvedValue({ txid: TXID });
        const { messaging, view } = mount({ onHoldLinks: vi.fn(), sendToken, linkWaiting: true });
        await openConfirm(messaging);
        expect(screen.queryByText(WAITING)).toBeNull();
        view.unmount();

        const second = mount({ onHoldLinks: vi.fn(), sendToken, linkWaiting: true });
        await approveToResult(second.messaging);
        expect(screen.getAllByText(WAITING)).toHaveLength(1);
    });

    it('shows no line when no link waits', async () => {
        const sendToken = vi.fn().mockResolvedValue({ txid: TXID });
        const { messaging } = mount({ onHoldLinks: vi.fn(), sendToken, linkWaiting: false });
        await approveToResult(messaging);
        expect(screen.queryByText(WAITING)).toBeNull();
    });
});

describe('Send release tells the shell how the user left', () => {
    it('reports open for Done on the result', async () => {
        const sendToken = vi.fn().mockResolvedValue({ txid: TXID });
        const onHoldLinks = vi.fn();
        const onDone = vi.fn();
        const { messaging, view } = mount({ onHoldLinks, sendToken, onDone });
        await approveToResult(messaging);
        fireEvent.click(screen.getByRole('button', { name: /^Done$/ }));
        expect(onDone).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(onHoldLinks).toHaveBeenLastCalledWith(false, { open: true });
    });

    it('reports open for Back on the result', async () => {
        const sendToken = vi.fn().mockResolvedValue({ txid: TXID });
        const onHoldLinks = vi.fn();
        const { messaging, view } = mount({ onHoldLinks, sendToken });
        await approveToResult(messaging);
        fireEvent.click(screen.getAllByRole('button', { name: /Back to Home/i })[0]);
        view.unmount();
        expect(onHoldLinks).toHaveBeenLastCalledWith(false, { open: true });
    });

    it('reports closed when Send unmounts by any other route', async () => {
        const sendToken = vi.fn().mockResolvedValue({ txid: TXID });
        const onHoldLinks = vi.fn();
        const { messaging, view } = mount({ onHoldLinks, sendToken });
        await approveToResult(messaging);
        view.unmount();
        expect(onHoldLinks).toHaveBeenLastCalledWith(false, { open: false });
    });
});

describe('desktop intake reports the waiting link and drops it on request', () => {
    const registry = registryLib.defaultRegistry();

    it('waiting is true only while held, and drop discards the link', async () => {
        const bridge = {
            takePending: vi.fn().mockResolvedValue({ raw: `bitcoin:${OTHER}?amount=0.5` }),
            onUri: vi.fn(() => () => {}),
        };
        const apply = vi.fn();
        const props = { bridge, detached: false, chainRegistry: registry, unlocked: true, walletId: 'w', held: true, apply };
        const { result, rerender } = renderHook((p) => useDeepLinks(p), { initialProps: props });
        await waitFor(() => expect(result.current.waiting).toBe(true));
        act(() => { result.current.drop(); });
        expect(result.current.waiting).toBe(false);
        rerender({ ...props, held: false });
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(apply).not.toHaveBeenCalled();
    });
});
