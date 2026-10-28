// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A payment link that arrives while Send shows an approved payment must not
// replace the screen that reports whether that payment went out. Send tells
// the shell when it holds such a payment (from Approve until it unmounts),
// and the desktop intake keeps the link waiting until the hold ends.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

function mount({ onHoldLinks, sendToken }) {
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
                React.createElement(Send, { walletId: 'w', onBack() {}, onHoldLinks }),
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

describe('Send holds incoming links from Approve until it unmounts', () => {
    it('holds while the approved payment is in flight and on its outcome, and releases on unmount', async () => {
        let finish;
        const sendToken = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const onHoldLinks = vi.fn();
        const { messaging, view } = mount({ onHoldLinks, sendToken });

        const approve = await openConfirm(messaging);
        expect(onHoldLinks).not.toHaveBeenCalled();
        fireEvent.click(approve);
        await waitFor(() => expect(sendToken).toHaveBeenCalled());
        expect(onHoldLinks).toHaveBeenCalledTimes(1);
        expect(onHoldLinks).toHaveBeenLastCalledWith(true);

        finish({ txid: TXID });
        await screen.findByRole('heading', { name: /Broadcast pending/i });
        expect(onHoldLinks).toHaveBeenCalledTimes(1);

        view.unmount();
        expect(onHoldLinks).toHaveBeenCalledTimes(2);
        expect(onHoldLinks).toHaveBeenLastCalledWith(false);
    });

    it('holds nothing for a payment that was never approved', async () => {
        const sendToken = vi.fn().mockResolvedValue({ txid: TXID });
        const onHoldLinks = vi.fn();
        const { messaging, view } = mount({ onHoldLinks, sendToken });

        await openConfirm(messaging);
        view.unmount();
        expect(sendToken).not.toHaveBeenCalled();
        expect(onHoldLinks).not.toHaveBeenCalled();
    });
});

describe('desktop link intake honours the Send hold', () => {
    const registry = registryLib.defaultRegistry();

    it('keeps a link waiting while held and applies it once the hold ends', async () => {
        const bridge = {
            takePending: vi.fn().mockResolvedValue({ raw: `bitcoin:${OTHER}?amount=0.5` }),
            onUri: vi.fn(() => () => {}),
        };
        const apply = vi.fn();
        const { rerender } = renderHook((props) => useDeepLinks(props), {
            initialProps: {
                bridge,
                detached: false,
                chainRegistry: registry,
                unlocked: true,
                walletId: 'w',
                held: true,
                apply,
            },
        });
        await waitFor(() => expect(bridge.takePending).toHaveBeenCalled());
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(apply).not.toHaveBeenCalled();

        rerender({
            bridge,
            detached: false,
            chainRegistry: registry,
            unlocked: true,
            walletId: 'w',
            held: false,
            apply,
        });
        await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
        expect(apply.mock.calls[0][0]).toMatchObject({
            view: 'send',
            sendPrefill: { address: OTHER, amount: '0.5' },
        });
    });
});
