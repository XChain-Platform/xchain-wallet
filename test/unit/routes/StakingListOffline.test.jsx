// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Staking on a phone whose services are all unreachable: each explorer read
// waits out its client retries before it fails, so a page that starts them
// sits on a skeleton for about a minute. The page takes the shared offline
// signal instead, says it is offline at once, skips the reads, and reads
// when the connection returns.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'offline' }));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: reachability.overall,
        perChain: [],
        refresh: vi.fn(),
        lastChecked: null,
        error: null,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';

const CHAIN = 'bitcoin-testnet';
const ADDRESS = 'tb1qstakingoffline00000000000000000000000';

function pending() {
    return new Promise(() => {});
}

function stakingMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getStakesForAddress: vi.fn(() => pending()),
        getDelegationsForAddress: vi.fn(() => pending()),
        getRewardsForAddress: vi.fn(() => pending()),
        getRewardClaimsForAddress: vi.fn(() => pending()),
        getContractStakesForAddress: vi.fn(() => pending()),
        getContractUnstakesForAddress: vi.fn(() => pending()),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakingList walletId="w1" onBack={() => {}} onOpenStake={() => {}} />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
    cleanup();
    delete navigator.onLine;
});

describe('StakingList offline', () => {
    it('shows its offline state at once and starts no explorer reads', async () => {
        reachability.overall = 'offline';
        const messaging = stakingMessaging();
        mount(messaging);

        expect(await screen.findByText("You're offline")).toBeInTheDocument();
        expect(screen.getByText('Staking positions load when the connection returns.')).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Loading staking positions' })).toBeNull();
        expect(messaging.getStakesForAddress).not.toHaveBeenCalled();
        expect(messaging.getContractStakesForAddress).not.toHaveBeenCalled();
    });

    it('reads positions when the services are reachable', async () => {
        reachability.overall = 'online';
        const messaging = stakingMessaging();
        mount(messaging);

        await waitFor(() => expect(messaging.getStakesForAddress).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading staking positions' })).toBeInTheDocument();
        expect(screen.queryByText("You're offline")).toBeNull();
    });
});
