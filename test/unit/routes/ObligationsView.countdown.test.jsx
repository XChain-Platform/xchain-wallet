// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const hookState = vi.hoisted(() => ({ obligations: [] }));

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useCoinpayObligations: () => ({
        obligations: hookState.obligations,
        scanning: false,
        refresh: vi.fn(),
    }),
}));

import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';

afterEach(() => {
    cleanup();
    hookState.obligations = [];
    vi.useRealTimers();
});

describe('ObligationsView countdown', () => {
    it('ticks to a plain expired state and stops its interval at zero', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-08T14:00:00Z'));
        hookState.obligations = [{
            chainId: 'litecoin-mainnet',
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

        expect(screen.getByText('2s left')).toBeInTheDocument();
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        act(() => vi.advanceTimersByTime(2_000));

        expect(screen.getByText('Expired')).toBeInTheDocument();
        expect(screen.queryByText(/0s|-\d+s/)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});
