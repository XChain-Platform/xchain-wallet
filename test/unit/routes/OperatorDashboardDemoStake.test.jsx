// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';

const CHAIN = 'bitcoin-regtest';
const DEMO_ID_KEY = 'xc:demoWalletId';
const DEMO_ID = 'demo-wallet-1';

function makeMessaging(overrides = {}) {
    const methods = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
        ...overrides,
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

function mount(walletId, overrides) {
    const harness = makeMessaging(overrides);
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
        await waitFor(() => expect(screen.getByText(/^Total amount staked:/)).toBeTruthy());
        expect(screen.queryByText(/No active stake on this address/)).toBeNull();
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
        expect(methods.getStakesForAddress).not.toHaveBeenCalled();
    });

    it('keeps the empty-state copy for a non-demo wallet with no stakes', async () => {
        const { methods } = mount('wallet-1');
        await waitFor(() => expect(screen.getByText(/No active stake/)).toBeTruthy());
        expect(methods.getStakesForAddress).toHaveBeenCalled();
    });

    it('hides the previous wallet and network data as soon as the route identity changes', async () => {
        const { messaging, methods } = makeMessaging();
        methods.getStakesForAddress
            .mockResolvedValueOnce([{ amount: '99', status: 'valid' }])
            .mockImplementationOnce(() => new Promise(() => {}));
        const renderDashboard = (walletId, chainId, address) => React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(OperatorDashboard, { walletId, chainId, address, onBack() {} }),
        );
        const view = render(renderDashboard('wallet-1', CHAIN, 'bcrt1qfirst'));
        expect(await screen.findByText('Total amount staked: 99 XCP')).toBeTruthy();

        view.rerender(renderDashboard('wallet-2', 'bitcoin-testnet', 'tb1qsecond'));

        expect(screen.queryByText('Total amount staked: 99 XCP')).toBeNull();
        expect(screen.getByText('Loading operator metrics…')).toBeTruthy();
        await waitFor(() => expect(methods.getStakesForAddress).toHaveBeenLastCalledWith({
            chainId: 'bitcoin-testnet', address: 'tb1qsecond',
        }));
    });

    it('shows plain feed lookup errors instead of claiming the feed is empty', async () => {
        const { messaging, methods } = makeMessaging();
        methods.getAddressesByChain = vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: 'bcrt1qfeed', source: 'hd' }],
        });
        methods.getBroadcastsForAddress.mockImplementation(({ opts }) => (
            opts
                ? Promise.reject(new TypeError('Cannot read properties of undefined'))
                : Promise.resolve({ data: [] })
        ));
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(OperatorDashboard, {
                walletId: 'wallet-1', chainId: CHAIN, address: 'bcrt1qfeed', onBack() {},
            }),
        ));
        fireEvent.click(await screen.findByRole('button', { name: 'Enter publisher mode' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't load the latest feed. Try again.",
        );
        expect(screen.queryByText(/Cannot read properties/)).toBeNull();
    });

    it('renders malformed validator metrics as bounded plain text', async () => {
        const signingPubkey = 'ab'.repeat(32);
        const rlo = String.fromCharCode(0x202e);
        mount('wallet-1', {
            getStakesForAddress: vi.fn().mockResolvedValue([
                { amount: '10', status: 'valid' },
            ]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([
                { signing_pubkey: signingPubkey, status: 'valid' },
            ]),
            getValidatorsForChain: vi.fn().mockResolvedValue([
                {
                    signing_pubkey: signingPubkey,
                    uptime: { malformed: true },
                    score: `9${rlo}1`,
                    last_seen_block: { malformed: true },
                },
            ]),
        });

        expect(await screen.findByText('Uptime: unavailable')).toBeInTheDocument();
        expect(screen.getByText('Validator score: 9\u24261')).toBeInTheDocument();
        expect(screen.getByText('Last seen at block: unavailable')).toBeInTheDocument();
    });
});
