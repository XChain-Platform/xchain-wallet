// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shell's reachability notice appears only while the device is offline.
// It never claims balances are stale, since the balance screens state an
// unchecked balance in their own rows and states.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { NoticesRouteContext } from '../../../packages/core/src/shared/components/noticesRoute.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const ROUTES = ['home:1', 'send:2', 'token-detail:3', 'history:4', 'receive:1'];
const COPY = "You're offline. Some information may be out of date.";

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

describe('the shell reachability notice names no stale balances', () => {
    it.each(ROUTES)('says the device is offline on %s while offline', (routeKey) => {
        mount('offline', routeKey);
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent(COPY);
        expect(screen.queryByText(/balances/)).toBeNull();
    });

    it.each(ROUTES)('shows no notice on %s while degraded', (routeKey) => {
        mount('degraded', routeKey);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('carries no balances wording in the English copy', () => {
        expect(Object.prototype.hasOwnProperty.call(en, 'reachability.notice.balances')).toBe(false);
    });
});
