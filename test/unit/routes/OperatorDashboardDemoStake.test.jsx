// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';

const CHAIN = 'bitcoin-regtest';
const DEMO_ID_KEY = 'xc:demoWalletId';
const DEMO_ID = 'demo-wallet-1';

function makeMessaging() {
    const methods = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
    return { messaging, methods };
}

function mount(walletId) {
    const harness = makeMessaging();
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging: harness.messaging },
        React.createElement(OperatorDashboard, {
            walletId, chainId: CHAIN, address: 'bcrt1qdemo', onBack() {},
        }),
    ));
    return harness;
}

beforeEach(() => { window.localStorage.setItem(DEMO_ID_KEY, DEMO_ID); });
afterEach(() => {
    cleanup();
    window.localStorage.removeItem(DEMO_ID_KEY);
});

describe('OperatorDashboard demo wallet staking', () => {
    it('shows the synthesized stake without querying the indexer', async () => {
        const { methods } = mount(DEMO_ID);
        await waitFor(() => expect(screen.getByText(/^Amount:/)).toBeTruthy());
        expect(screen.queryByText(/No active stake on this address/)).toBeNull();
        expect(methods.getStakesForAddress).not.toHaveBeenCalled();
    });

    it('keeps the empty-state copy for a non-demo wallet with no stakes', async () => {
        const { methods } = mount('wallet-1');
        await waitFor(() => expect(screen.getByText(/No active stake on this address/)).toBeTruthy());
        expect(methods.getStakesForAddress).toHaveBeenCalled();
    });
});
