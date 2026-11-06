// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An empty History read while balances could not be checked says once that
// activity shows when the network answers. It never claims a balance is out
// of date, and the shell's reachability notice steps aside so the page holds
// one message.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const reach = vi.hoisted(() => ({ overall: 'degraded' }));
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: reach.overall,
        perChain: [],
        refresh: () => {},
        lastChecked: null,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { BalancesUncheckedState } from '../../../packages/core/src/shared/components/BalancesUncheckedState.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const HISTORY_BODY = 'Activity shows here once the wallet reaches the network.';

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => { cleanup(); window.localStorage.clear(); reach.overall = 'degraded'; });

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
    };
}

function mountHistory() {
    return render(
        <MessagingProvider shell="web" messaging={makeMessaging()}>
            <FullLayoutWithNav routeKey="history:1" notices={<ReachabilityBanner />}>
                <History walletId="wallet-unchecked" accountId="account-a" />
            </FullLayoutWithNav>
        </MessagingProvider>,
    );
}

describe('History empty state names no stale balances', () => {
    it('says once that activity shows when the network answers while degraded', async () => {
        mountHistory();
        expect(await screen.findByText("Balances couldn't be checked")).toBeInTheDocument();
        expect(screen.getAllByText(HISTORY_BODY)).toHaveLength(1);
        expect(screen.queryByText(/out of date/)).toBeNull();
        expect(screen.queryByText('No activity yet')).toBeNull();
    });

    it('carries no stale-balance claim and no second notice while offline', async () => {
        reach.overall = 'offline';
        mountHistory();
        expect(await screen.findByText('History loads when the connection returns.')).toBeInTheDocument();
        expect(screen.queryByText(/out of date/)).toBeNull();
    });

    it('takes a screen body in place of the shared one', () => {
        render(<BalancesUncheckedState onRetry={() => {}} body="Screen body." />);
        expect(screen.getByText('Screen body.')).toBeInTheDocument();
        expect(screen.queryByText(/out of date/)).toBeNull();
    });
});
