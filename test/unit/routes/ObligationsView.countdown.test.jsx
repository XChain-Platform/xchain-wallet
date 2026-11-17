// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const hookState = vi.hoisted(() => ({ obligations: [] }));

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useCoinpayObligations: () => ({
        obligations: hookState.obligations,
        scanning: false,
        refresh: vi.fn(),
    }),
}));

// The countdown owns the only timer under test; the connection verdict is fixed.
vi.mock('../../../packages/core/src/shared/hooks/useNetworkOffline.js', () => ({
    useNetworkOffline: () => ({ offline: false, recheck: vi.fn() }),
}));

import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';

afterEach(() => {
    cleanup();
    hookState.obligations = [];
    vi.useRealTimers();
});

describe('ObligationsView countdown', () => {
    it('does not show auto-pay status from the previous wallet while the next one loads', async () => {
        let finishWalletTwo;
        const walletTwoStatus = new Promise((resolve) => { finishWalletTwo = resolve; });
        const messaging = {
            getAutopayStatus: vi.fn(({ walletId }) => (walletId === 'wallet-1'
                ? Promise.resolve({ armed: 1, unsignableWalletIds: [] })
                : walletTwoStatus)),
        };
        const view = (walletId) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <ObligationsView walletId={walletId} onPay={() => {}} onBack={() => {}} />
            </MessagingProvider>
        );
        const utils = render(view('wallet-1'));
        await waitFor(() => expect(screen.getByText(/auto pay is armed for 1 order/i)).toBeTruthy());

        utils.rerender(view('wallet-2'));
        expect(screen.queryByText(/auto pay is armed/i)).toBeNull();

        await act(async () => { finishWalletTwo({ armed: 0, unsignableWalletIds: [] }); });
        expect(screen.queryByText(/auto pay is armed/i)).toBeNull();
    });

    it('colours the ring green with plenty of time and red under 30 minutes, ring before chevron', () => {
        const now = Math.floor(Date.now() / 1000);
        const row = (index, left) => ({
            chainId: 'litecoin-testnet',
            address: 'ltc1payer',
            payeeAddress: 'ltc1payee',
            orderMatchActionIndex: index,
            coinAmount: '0.5',
            expiration: now + left,
        });
        hookState.obligations = [row('1', 3600), row('2', 29 * 60)];
        const messaging = { getAutopayStatus: vi.fn().mockResolvedValue(null) };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ObligationsView walletId="wallet" onPay={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        const rings = [...container.querySelectorAll('[data-fill-ring]')];
        expect(rings.map((r) => r.getAttribute('data-tone'))).toEqual(['success', 'danger']);
        // Order inside a row: ring slot, then the chevron.
        const button = rings[0].closest('button');
        const kids = [...button.children];
        const ringAt = kids.findIndex((k) => k.contains(rings[0]));
        expect(ringAt).toBe(kids.length - 2);
    });

    it('drops the row when its window closes and stops its interval at zero', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-08T14:00:00Z'));
        hookState.obligations = [{
            chainId: 'litecoin-testnet',
            address: 'ltc1payer',
            payeeAddress: 'ltc1payee',
            orderMatchActionIndex: '42',
            coinAmount: '0.5',
            expiration: Math.floor(Date.now() / 1000) + 2,
        }];
        const messaging = { getAutopayStatus: vi.fn().mockResolvedValue(null) };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ObligationsView walletId="wallet" onPay={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(screen.getByText('2s')).toBeInTheDocument();
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        act(() => vi.advanceTimersByTime(2_000));

        // An expired payment is not listed at all; the page reads as empty.
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByText('No payments due')).toBeInTheDocument();
        expect(screen.queryByText(/Expired|0s|-\d+s/)).toBeNull();
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
        expect(vi.getTimerCount()).toBe(0);
    });
});
