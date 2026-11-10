// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: a demo wallet shows populated DeFi, My orders and My swaps
// surfaces. The orders and swaps fixtures carry the fields the two views
// read, repeat exactly at one frozen instant, and the views render them in
// place of their empty states.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as flows from '../../../packages/core/src/flows/index.js';
import {
    synthesizeDemoDefiPositions,
    synthesizeDemoOrders,
    synthesizeDemoSwaps,
} from '../../../packages/core/src/flows/demoFixtures.js';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';

const NOW = Date.UTC(2026, 0, 15, 15, 4, 0);
const WALLET = 'demo-coverage-wallet';
const OWNER = {
    id: 'demo-address',
    address: 'bc1qdemoownerownerownerownerownerownerowne',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('demo DeFi positions', () => {
    it('cover stake, dispenser and contract kinds', () => {
        const kinds = new Set(synthesizeDemoDefiPositions({ now: NOW }).map((p) => p.kind));
        expect([...kinds].sort()).toEqual(['contract', 'dispenser', 'stake']);
    });
});

describe.each([
    ['orders', synthesizeDemoOrders],
    ['swaps', synthesizeDemoSwaps],
])('demo %s fixture', (name, synthesize) => {
    it('is exported from the flows index', () => {
        expect(typeof synthesize).toBe('function');
        expect(name === 'orders' ? flows.synthesizeDemoOrders : flows.synthesizeDemoSwaps).toBe(synthesize);
    });

    it.each(['bitcoin-mainnet', 'bitcoin-regtest', 'litecoin-mainnet', 'dogecoin-testnet'])(
        'returns owned rows with the fields the view reads on %s',
        (chainId) => {
            const rows = synthesize(chainId, OWNER.address, { now: NOW });
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                expect(row.source).toBe(OWNER.address);
                expect(row.action_index).toMatch(/^[1-9]\d*$/);
                expect(row.status).toBe('valid');
                expect(Number(row.give_amount)).toBeGreaterThan(0);
                expect(Number(row.get_amount)).toBeGreaterThan(0);
                expect(row.give_tick || row.give_coin).toBeTruthy();
                expect(row.get_tick || row.get_coin).toBeTruthy();
                expect(Number.isInteger(row.expiration)).toBe(true);
                expect(typeof row.state?.status).toBe('string');
                expect(row.state.status.length).toBeGreaterThan(0);
            }
            expect(rows.some((row) => row.state.status === 'open'
                && row.expiration > Math.floor(NOW / 1000))).toBe(true);
            expect(new Set(rows.map((row) => row.action_index)).size).toBe(rows.length);
        },
    );

    it('repeats exactly at one injected instant and moves with the clock', () => {
        const first = synthesize('bitcoin-mainnet', OWNER.address, { now: NOW });
        const second = synthesize('bitcoin-mainnet', OWNER.address, { now: NOW });
        expect(second).toEqual(first);
        const later = synthesize('bitcoin-mainnet', OWNER.address, { now: NOW + 60_000 });
        expect(later).not.toEqual(first);
    });

    it('returns nothing without an owner address', () => {
        expect(synthesize('bitcoin-mainnet', '', { now: NOW })).toEqual([]);
    });
});

function demoMessaging() {
    const networkReads = [];
    const network = (label) => vi.fn(async () => {
        networkReads.push(label);
        return {};
    });
    return {
        networkReads,
        messaging: {
            getAddressesByChain: vi.fn(async () => ({ 'bitcoin-mainnet': [OWNER] })),
            getSettings: vi.fn(async () => ({ walletMode: 'full', activeNetwork: 'mainnet' })),
            getOrdersForAddress: network('orders'),
            getOrderCancelsForAddress: network('order cancels'),
            getOrderDetail: network('order detail'),
            listAutopayOrders: network('autopay'),
            getSwapsForAddress: network('swaps'),
            getSwapCancelsForAddress: network('swap cancels'),
            getSwapDetail: network('swap detail'),
        },
    };
}

function provider(messaging, child) {
    return React.createElement(MessagingProvider, { shell: 'web', messaging }, child);
}

describe('demo wallet market lists', () => {
    it('My orders lists the demo orders instead of the empty state', async () => {
        markDemoWallet(WALLET);
        const { messaging, networkReads } = demoMessaging();
        render(provider(messaging, React.createElement(MyOrdersView, { walletId: WALLET, onBack: () => {} })));
        const open = await screen.findByRole('list', { name: 'Open orders' });
        expect(open.querySelectorAll('li').length).toBeGreaterThan(0);
        expect(screen.queryByText('No orders yet')).toBeNull();
        expect(screen.getAllByTitle(OWNER.address).length).toBeGreaterThan(0);
        expect(networkReads).toEqual([]);
    });

    it('My swaps lists the demo swaps instead of the empty state', async () => {
        markDemoWallet(WALLET);
        const { messaging, networkReads } = demoMessaging();
        render(provider(messaging, React.createElement(MySwapsView, { walletId: WALLET, onBack: () => {} })));
        const open = await screen.findByRole('list', { name: 'Open swaps' });
        expect(open.querySelectorAll('li').length).toBeGreaterThan(0);
        expect(screen.queryByText('No swaps yet')).toBeNull();
        expect(networkReads).toEqual([]);
    });
});
