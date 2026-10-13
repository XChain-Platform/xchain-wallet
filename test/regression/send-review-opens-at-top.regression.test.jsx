// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: review screen entry.
//
//   [P1] 2026-10-13: Review transitions reset retained scroll, announce the
//        review heading through focus, and accept one approval per gesture.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ConfirmActionModal } from '../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { Send } from '../../packages/core/src/shared/routes/Send.jsx';
import { Screen as LayoutScreen, ScrollRestoration } from '../../packages/core/src/ui/Screen.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'review-scroll-wallet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function sendMessaging() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
                id: 'address-1',
                address: FROM,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_ID]: { id: 'address-1', address: FROM },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'watcher',
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[property] = stub;
            return stub;
        },
    });
}

function confirmProps(overrides = {}) {
    return {
        phase: 'ready',
        composed: { psbt: 'reviewed-psbt' },
        report: { verdict: 'pass', restricted: false, findings: [], unverified: [] },
        reportLoading: false,
        acknowledged: new Set(),
        onAcknowledge() {},
        canApprove: true,
        onApprove: vi.fn(),
        onReject: vi.fn(),
        decoded: {
            summary: 'Send 1 BTC',
            details: [{ label: 'Amount', value: '1' }],
            warnings: [],
        },
        chainLabel: 'Bitcoin',
        credentials: <input aria-label="Password" />,
        credentialsReady: true,
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('regression/send-review-opens-at-top', () => {
    it('[REGRESSION P1] opens Send review at scrollTop 0 with focus on its heading', async () => {
        const messaging = sendMessaging();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Send walletId={WALLET_ID} onBack={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        const scroller = screen.getByRole('main');
        scroller.scrollTop = 420;
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        await screen.findByRole('form', { name: 'Review payment' });
        expect(scroller.scrollTop).toBe(0);
        expect(screen.getByRole('heading', { name: 'Review and send' })).toHaveFocus();
    });

    it('[REGRESSION P1] opens shared confirmation at the top and submits one double-tapped approval', async () => {
        const onApprove = vi.fn(() => new Promise(() => {}));
        const { rerender } = render(
            <ScrollRestoration routeKey="send">
                <LayoutScreen><button type="button">Open review</button></LayoutScreen>
            </ScrollRestoration>,
        );
        const composeScroller = screen.getByRole('main');
        composeScroller.scrollTop = 480;
        screen.getByRole('button', { name: 'Open review' }).focus();

        rerender(
            <ScrollRestoration routeKey="send">
                <ConfirmActionModal {...confirmProps({ onApprove })} />
            </ScrollRestoration>,
        );

        const reviewScroller = screen.getByRole('main');
        expect(reviewScroller.scrollTop).toBe(0);
        expect(screen.getByRole('heading', { name: 'Confirm' })).toHaveFocus();

        const approve = screen.getByTestId('confirm-approve');
        fireEvent.click(approve);
        fireEvent.click(approve);

        await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
        expect(approve).toBeDisabled();
    });
});
