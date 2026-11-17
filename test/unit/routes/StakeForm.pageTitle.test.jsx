// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Stake form's page title follows its Action field: Stake, Unstake,
// Claim, Delegate or Revoke, from the first render on a preset action and
// after a change. The window title names the same heading (U25).
//
// Queries go through `container`: this form renders a large tree.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { useDocumentTitle } from '../../../packages/core/src/shared/hooks/useDocumentTitle.js';
import { StakingForm } from '../../../packages/core/src/shared/routes/StakingForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// The route id each preset action opens on, as routeRegistry maps them.
const ROUTES = [
    ['stake-form', 'stake', 'Stake'],
    ['staking-unstake', 'unstake', 'Unstake'],
    ['staking-claim', 'claim-rewards', 'Claim'],
    ['staking-delegate', 'delegate', 'Delegate'],
    ['staking-revoke', 'revoke', 'Revoke'],
];

function Host({ route, action }) {
    useDocumentTitle({ statusState: 'unlocked', unlockedView: route });
    return <StakingForm walletId="w" target={{ kind: 'network', chainId: CHAIN }} action={action} onBack={() => {}} />;
}

function mount(route, action) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode: 'full' }]),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        getStakesForAddress: () => Promise.resolve([]),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Host route={route} action={action} />
        </MessagingProvider>,
    );
    return container;
}

const heading = (container) => container.querySelector('h1')?.textContent;

afterEach(() => {
    cleanup();
    resetWalletModes();
    localStorage.clear();
});

describe('StakingForm page title', () => {
    it.each(ROUTES)('opens %s titled %s2 on its preset action', async (route, action, label) => {
        const container = mount(route, action);
        await waitFor(() => expect(heading(container)).toBe(label));
        expect(document.title).toBe(`XChain Wallet - ${label}`);
    });

    it.each(ROUTES)('follows the Action field to %s2 after a change', async (_route, _action, label) => {
        // Open on a different action than the one picked, so the title must change.
        const start = label === 'Delegate' ? 'stake' : 'delegate';
        const route = label === 'Delegate' ? 'stake-form' : 'staking-delegate';
        const container = mount(route, start);
        await waitFor(() => expect(container.querySelector('button[aria-haspopup="listbox"]')).not.toBeNull());
        const trigger = Array.from(container.querySelectorAll('button')).find((b) => /^Action:/.test(b.getAttribute('aria-label') || ''));
        fireEvent.click(trigger);
        const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent.trim().startsWith(label));
        fireEvent.click(option);
        await waitFor(() => expect(heading(container)).toBe(label));
        expect(document.title).toBe(`XChain Wallet - ${label}`);
    });
});
