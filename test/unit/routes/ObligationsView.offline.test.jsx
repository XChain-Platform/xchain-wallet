// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Payments due with the network unreachable: the page shows the shared
// offline state once, with Try again, instead of a scanning line or an empty
// "No payments due" claim, and the scan is held until the connection returns.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const state = vi.hoisted(() => ({
    offline: true,
    recheck: vi.fn(),
    scanOptions: /** @type {any} */ (null),
    scanning: true,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNetworkOffline.js', () => ({
    useNetworkOffline: () => ({ offline: state.offline, recheck: state.recheck }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useCoinpayObligations: (_walletId, _accountId, options) => {
        state.scanOptions = options;
        return { obligations: [], scanning: state.scanning, error: null, refresh: vi.fn() };
    },
}));

import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';

afterEach(() => {
    cleanup();
    state.offline = true;
    state.scanning = true;
    state.scanOptions = null;
    state.recheck.mockReset();
});

function renderView() {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <ObligationsView walletId="w1" onPay={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('ObligationsView offline', () => {
    it('shows the offline state once and never the scanning line', () => {
        renderView();
        expect(screen.getAllByText("You're offline")).toHaveLength(1);
        expect(screen.queryByText(/Scanning for payments due/)).toBeNull();
        expect(screen.queryByText('No payments due')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Refresh payments' })).toBeNull();
        expect(state.scanOptions.offline).toBe(true);
    });

    it('rechecks the connection from Try again', () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(state.recheck).toHaveBeenCalledTimes(1);
    });

    it('scans and shows its own states when online', () => {
        state.offline = false;
        renderView();
        expect(screen.queryByText("You're offline")).toBeNull();
        expect(screen.getByText(/Scanning for payments due/)).toBeTruthy();
        expect(state.scanOptions.offline).toBe(false);
    });
});
