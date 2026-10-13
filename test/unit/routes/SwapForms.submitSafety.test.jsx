// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'BETA' })}
        >
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-a',
    address: 'bc1qexample',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 's1',
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function messaging(composeForConfirm, { walletMode = 'full', buildActionPsbtRequest } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8 }),
        composeForConfirm,
        ...(buildActionPsbtRequest ? { buildActionPsbtRequest } : {}),
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

async function fillSwap() {
    await screen.findByRole('button', { name: /Get token:/ });
    fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
    fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });
}

async function expectOneLockedCompose({ children, fill, actionName }) {
    const pending = deferred();
    const composeForConfirm = vi.fn(() => pending.promise);
    render(
        <MessagingProvider shell="desktop" messaging={messaging(composeForConfirm)}>
            {children}
        </MessagingProvider>,
    );
    await fill();
    const action = screen.getByRole('button', { name: actionName });
    fireEvent.click(action);
    fireEvent.click(action);

    await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    expect(action.closest('form')).toHaveAttribute('inert');
    expect(action.closest('form')).toHaveAttribute('aria-busy', 'true');
}

describe('swap form submit safety', () => {
    it('locks and de-duplicates SwapForm while its exact terms compose', async () => {
        await expectOneLockedCompose({
            children: <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />,
            actionName: 'Review',
            fill: fillSwap,
        });
    });

    it('locks and de-duplicates SellOwnershipForm while its price composes', async () => {
        await expectOneLockedCompose({
            children: <SellOwnershipForm walletId="w" onBack={() => {}} chainId={BTC} tick="ALPHA" />,
            actionName: 'List name for sale',
            fill: async () => {
                const price = await screen.findByLabelText(/^Price/);
                fireEvent.change(price, { target: { value: '5' } });
            },
        });
    });

    it('dispatches only one watcher swap for two same-tick submits', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: 'aa00' });
        render(
            <MessagingProvider
                shell="desktop"
                messaging={messaging(vi.fn(), { walletMode: 'watcher', buildActionPsbtRequest })}
            >
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await fillSwap();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const action = await screen.findByRole('button', { name: 'Create unsigned transaction' });
        const form = action.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });

    it('dispatches only one watcher ownership sale for two same-tick submits', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: 'aa00' });
        render(
            <MessagingProvider
                shell="desktop"
                messaging={messaging(vi.fn(), { walletMode: 'watcher', buildActionPsbtRequest })}
            >
                <SellOwnershipForm walletId="w" onBack={() => {}} chainId={BTC} tick="ALPHA" />
            </MessagingProvider>,
        );
        const price = await screen.findByLabelText(/^Price/);
        fireEvent.change(price, { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const action = await screen.findByRole('button', { name: /Create unsigned transaction/ });
        const form = action.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });
});
