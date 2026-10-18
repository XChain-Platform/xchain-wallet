// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The reachability notice names balances only on a screen that can show one.
// Screens without balances get copy about the screen's information in
// general, and every screen still carries exactly one notice.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import {
    NoticesRouteContext,
    routeMayShowBalances,
} from '../../../packages/core/src/shared/components/noticesRoute.js';

function mount(overall, routeKey) {
    useReachability.mockReturnValue({
        loading: false, overall, perChain: [], refresh: () => {}, lastChecked: null,
    });
    return render(
        <NoticesRouteContext.Provider value={routeKey}>
            <ReachabilityBanner />
        </NoticesRouteContext.Provider>,
    );
}

afterEach(() => { cleanup(); useReachability.mockReset(); });

describe('ReachabilityBanner copy by screen', () => {
    it.each([
        'receive', 'contacts', 'obligations', 'settings', 'scan', 'markets',
        'add-wallet', 'add-account', 'wallet-rename', 'account-rename', 'sign-message',
        'verify-signature', 'view-private-key', 'migrate-bip39', 'pair-signer',
        'dispenser-explorer', 'market-activity',
    ])(
        'says the screen may be out of date, not its balances, on %s while offline',
        (view) => {
            mount('offline', `${view}:1`);
            expect(screen.getAllByRole('status')).toHaveLength(1);
            expect(screen.getByRole('status'))
                .toHaveTextContent("You're offline. Some information may be out of date.");
            expect(screen.queryByText(/balances/)).toBeNull();
        },
    );

    it('drops the offline claim when only some services are down', () => {
        mount('degraded', 'contacts:1');
        expect(screen.getByRole('status')).toHaveTextContent('Some information may be out of date');
        expect(screen.queryByText(/offline/i)).toBeNull();
    });

    it.each(['home:1', 'send:2', 'token-detail:3', 'history:4'])(
        'keeps the balance wording on %s',
        (routeKey) => {
            mount('offline', routeKey);
            expect(screen.getByRole('status')).toHaveTextContent('Some balances may be out of date');
        },
    );

    it('treats a missing route key as a balance screen', () => {
        mount('offline', null);
        expect(screen.getByRole('status')).toHaveTextContent('Some balances may be out of date');
        expect(routeMayShowBalances(undefined)).toBe(true);
    });
});
