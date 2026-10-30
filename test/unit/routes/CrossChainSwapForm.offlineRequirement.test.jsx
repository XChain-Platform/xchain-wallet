// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// With addresses on one network only, the cross-chain swap page states the
// two-networks requirement while online; offline its one message is the
// offline note, and the requirement shows once the device is back online.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'offline' }));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false, overall: reachability.overall, perChain: [], refresh: vi.fn(), lastChecked: null, error: null,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const REQUIREMENT = /needs addresses on two different networks/;

function messaging() {
    return new Proxy({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'address-1', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
    }, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            target[prop] = vi.fn().mockResolvedValue(null);
            return target[prop];
        },
    });
}

function mount() {
    return render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <CrossChainSwapForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

let savedObserver;
beforeAll(() => {
    savedObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = savedObserver; });
afterEach(() => { cleanup(); delete navigator.onLine; });

describe('CrossChainSwapForm with addresses on one network', () => {
    it('shows only the offline note while offline', async () => {
        reachability.overall = 'offline';
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const { container } = mount();
        await screen.findByText('Swapping needs a network connection.');
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.queryByText(REQUIREMENT)).toBeNull();
        expect(container.querySelectorAll('[data-variant]')).toHaveLength(1);
    });

    it('states the two-networks requirement once online', async () => {
        reachability.overall = 'normal';
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const { container } = mount();
        await screen.findByText(REQUIREMENT);
        expect(screen.queryByText('Swapping needs a network connection.')).toBeNull();
        expect(container.querySelectorAll('[data-variant]')).toHaveLength(1);
    });
});
