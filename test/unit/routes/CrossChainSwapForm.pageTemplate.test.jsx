// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the cross-chain swap page draws through a page template:
// the load error, the offline note and each result sit inside the ListPage
// root, never straight inside Screen beside it.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'normal' }));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false, overall: reachability.overall, perChain: [], refresh: vi.fn(), lastChecked: null, error: null,
    }),
}));

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: title.includes('give') ? 'dogecoin-mainnet' : 'bitcoin-mainnet',
                tick: title.includes('give') ? 'ALPHA' : 'BETA',
            })}
        >
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const address = (id, value) => ({
    id, address: value, publicKey: '02ab', derivationPath: "m/44'/0'/0'/0/0", source: 'hd', signerId: 's1',
});
const TWO_NETWORKS = { [DOGE]: [address('doge-a', 'Ddevmock02ab')], [BTC]: [address('btc-a', 'bc1qdevmock02ab')] };
const ONE_NETWORK = { [BTC]: [address('btc-a', 'bc1qdevmock02ab')] };
const REQUIREMENT = /needs addresses on two different networks/;

function messaging({ byChain = TWO_NETWORKS, buildActionPsbtRequest = vi.fn().mockResolvedValue(null) } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockImplementation((_walletId, chainId) => (
            Promise.resolve((byChain[chainId] || [])[0] || null)
        )),
        getWalletBalances: vi.fn().mockResolvedValue(Object.fromEntries(
            Object.entries(byChain).map(([chainId, addrs]) => [chainId, addrs.map((entry) => ({
                address: entry.address,
                balances: {
                    tokens: ['ALPHA', 'BETA'].map((tick) => ({ tick, quantity: '100.0', divisibility: 8 })),
                },
            }))]),
        )),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'watcher' }),
        composeForConfirm: vi.fn().mockResolvedValue({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        getTokenInfo: vi.fn().mockImplementation(({ chainId, tick }) => Promise.resolve({ chainId, tick, divisibility: 8 })),
        buildActionPsbtRequest,
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            target[prop] = vi.fn().mockResolvedValue(null);
            return target[prop];
        },
    });
}

function mount(options) {
    return render(
        <MessagingProvider shell="desktop" messaging={messaging(options)}>
            <CrossChainSwapForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function buildWith(buildResult) {
    mount({ buildActionPsbtRequest: vi.fn().mockResolvedValue(buildResult) });
    await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
    fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
    fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const submit = await screen.findByRole('button', { name: 'Create unsigned transaction' });
    await act(async () => {
        submit.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
}

function inListPage(node) {
    return node.closest('.' + listPageStyles.page);
}

let savedObserver;
beforeAll(() => {
    savedObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = savedObserver; });
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    reachability.overall = 'normal';
    delete navigator.onLine;
});

describe('CrossChainSwapForm page template', () => {
    it('draws the load error inside the ListPage template', async () => {
        mount({ byChain: ONE_NETWORK });
        const error = await screen.findByText(REQUIREMENT);
        expect(inListPage(error)).not.toBeNull();
    });

    it('draws the offline note inside the ListPage template when the page has nothing else to show', async () => {
        reachability.overall = 'offline';
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        mount({ byChain: ONE_NETWORK });
        const note = await screen.findByText('Swapping needs a network connection.');
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(inListPage(note)).not.toBeNull();
    });

    it('draws the broadcast result inside the ListPage template', async () => {
        await buildWith({ txid: 'swap-tx' });
        const heading = await screen.findByText('Cross-chain swap broadcast');
        expect(inListPage(heading)).not.toBeNull();
        expect(inListPage(screen.getByRole('button', { name: 'Done' }))).not.toBeNull();
    });

    it('draws the unsigned result inside the ListPage template', async () => {
        await buildWith({ psbtHex: 'aa00' });
        const notice = await screen.findByTestId('result-screen-notice');
        expect(inListPage(notice)).not.toBeNull();
    });

    it('draws the signed-not-broadcast result inside the ListPage template', async () => {
        await buildWith({ txid: 'swap-tx', queued: true, unsaved: false });
        const notice = await screen.findByTestId('result-screen-notice');
        expect(inListPage(notice)).not.toBeNull();
    });
});
