// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One message, not two: when balances could not be checked, Send with a
// zero read says so once ("Balances couldn't be checked" with Try again)
// instead of "Nothing to send yet" beside the stale-balances notice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const reachability = vi.hoisted(() => ({
    overall: 'normal',
    loading: false,
    refresh: null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        overall: reachability.overall,
        loading: reachability.loading,
        perChain: [{ chainId: 'bitcoin-mainnet', mode: reachability.overall }],
        lastChecked: null,
        refresh: reachability.refresh,
        error: null,
    }),
}));

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');
const { FullLayoutWithNav } = await import('../../../packages/core/src/shared/components/LeftNav.jsx');
const { ReachabilityBanner } = await import('../../../packages/core/src/shared/components/ReachabilityBanner.jsx');

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

function makeMessaging(quantity) {
    const balances = { native: { tick: 'BTC', quantity, divisibility: 8 }, tokens: [] };
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue(balances),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ address: FROM, balances, error: null }],
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', grace: { testSendThresholdSats: 0 } }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function mount(quantity, { inShell = false } = {}) {
    const messaging = makeMessaging(quantity);
    const onReceive = vi.fn();
    const send = React.createElement(Send, { walletId: 'w', onBack() {}, onReceive });
    const tree = inShell
        ? React.createElement(FullLayoutWithNav, {
            routeKey: 'send',
            nav: React.createElement('nav'),
            notices: React.createElement(ReachabilityBanner),
        }, send)
        : send;
    render(React.createElement(MessagingProvider, { shell: 'web', messaging }, tree));
    return { messaging, onReceive };
}

beforeEach(() => {
    reachability.overall = 'normal';
    reachability.loading = false;
    reachability.refresh = vi.fn();
});

afterEach(() => cleanup());

describe('Send empty state and the balance check', () => {
    it('says "Nothing to send yet" when the empty read is trustworthy', async () => {
        mount('0');
        expect(await screen.findByRole('heading', { name: 'Nothing to send yet' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: "Balances couldn't be checked" })).toBeNull();
    });

    it('shows one unchecked-balances state when balances could not be checked', async () => {
        reachability.overall = 'degraded';
        const { messaging, onReceive } = mount('0');

        const heading = await screen.findByRole('heading', { name: "Balances couldn't be checked" });
        expect(heading).toBeInTheDocument();
        expect(screen.getByText('Your balance may be out of date. Try again to refresh it.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Nothing to send yet' })).toBeNull();
        // Plain, full-width page content, like the trustworthy empty state.
        expect(heading.closest('[role="status"]').parentElement).toBe(screen.getByRole('main'));

        const checksBefore = messaging.getWalletBalances.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reachability.refresh).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(messaging.getWalletBalances.mock.calls.length).toBeGreaterThan(checksBefore));

        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        expect(onReceive).toHaveBeenCalledTimes(1);
    });

    it('shows the form with its one offline notice on an offline verdict, without a balance read', async () => {
        // Offline the read cannot finish, so the form does not wait on it.
        reachability.overall = 'offline';
        const { messaging } = mount('0', { inShell: true });
        expect(await screen.findByRole('form', { name: 'Send' })).toBeInTheDocument();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(screen.getByText(/Sending needs a network connection/)).toBeInTheDocument();
        expect(screen.queryByText('Some balances may be out of date')).toBeNull();
        expect(screen.queryByRole('heading', { name: "Balances couldn't be checked" })).toBeNull();
    });

    it('keeps the form when the wallet holds coin, whatever the check says', async () => {
        reachability.overall = 'degraded';
        mount('100000000');
        expect(await screen.findByRole('form', { name: 'Send' }, { timeout: 10_000 })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: "Balances couldn't be checked" })).toBeNull();
    });

    it('does not also show the stale-balances notice on that screen', async () => {
        reachability.overall = 'degraded';
        mount('0', { inShell: true });
        expect(await screen.findByRole('heading', { name: "Balances couldn't be checked" })).toBeInTheDocument();
        expect(screen.queryByText('Some balances may be out of date')).toBeNull();
    });

    it('shows the notice once in the page content when Send has a form to show', async () => {
        reachability.overall = 'degraded';
        mount('100000000', { inShell: true });
        await screen.findByRole('form', { name: 'Send' }, { timeout: 10_000 });
        const notice = screen.getByText('Some balances may be out of date');
        expect(screen.getByRole('main').contains(notice)).toBe(true);
        expect(screen.getAllByText('Some balances may be out of date')).toHaveLength(1);
    });
});
