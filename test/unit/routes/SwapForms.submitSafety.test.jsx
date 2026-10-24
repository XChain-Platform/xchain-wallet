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
const REGTEST = 'bitcoin-regtest';
const ADDRESS = {
    id: 'btc-a',
    address: 'bc1qexample',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 's1',
};
const REGTEST_ADDRESS = { ...ADDRESS, id: 'btc-regtest-a', address: 'bcrt1qexample' };

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    delete navigator.onLine;
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function messaging(composeForConfirm, { walletMode = 'full', buildActionPsbtRequest } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [ADDRESS],
            [REGTEST]: [REGTEST_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue({
            [BTC]: [{
                address: ADDRESS.address,
                balances: {
                    tokens: [
                        { tick: 'ALPHA', quantity: '100.0', divisibility: 8 },
                        { tick: 'BETA', quantity: '100.0', divisibility: 8 },
                    ],
                },
            }],
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        // ADDRESS issued ALPHA, so the owner-only ownership sale opens for it.
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8, creator: ADDRESS.address }),
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
    it('blocks composition with one plain reason while the device is offline', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const composeForConfirm = vi.fn();
        render(
            <MessagingProvider shell="desktop" messaging={messaging(composeForConfirm)}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );

        await fillSwap();
        expect(screen.getAllByText('Swapping needs a network connection.')).toHaveLength(1);
        const review = screen.getByRole('button', { name: 'Review' });
        expect(review).toBeDisabled();
        fireEvent.submit(review.closest('form'));
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('stops preparing and shows one plain error when composition rejects', async () => {
        const composeForConfirm = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
        render(
            <MessagingProvider shell="desktop" messaging={messaging(composeForConfirm)}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );

        await fillSwap();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled());
        const errors = screen.getAllByRole('alert');
        expect(errors).toHaveLength(1);
        expect(errors[0]).toHaveTextContent(/connection|try again/i);
    });

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

    it('does not render the selected network kind in SellOwnershipForm', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging(vi.fn())}>
                <SellOwnershipForm walletId="w" onBack={() => {}} chainId={REGTEST} tick="ALPHA" />
            </MessagingProvider>,
        );

        await screen.findByLabelText(/^Price/);
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
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

    it.each([
        ['over 250 bytes', 'x'.repeat(251), /251 bytes; the network accepts at most 250 bytes/],
        // The shared action-text refusal answers first, before the memo's own check.
        ['a bidirectional override', 'pay \u202etxt.exe', /Memo cannot contain text-direction control characters/],
        ['a tab', 'a\tb', /Memo cannot contain control characters/],
    ])('refuses a memo %s before composing', async (_label, memo, message) => {
        const composeForConfirm = vi.fn().mockResolvedValue({ psbt: 'aa00' });
        render(
            <MessagingProvider shell='desktop' messaging={messaging(composeForConfirm)}>
                <SwapForm walletId='w' onBack={() => {}} initialChainId={BTC} initialGiveTick='ALPHA' />
            </MessagingProvider>,
        );
        await fillSwap();
        fireEvent.change(screen.getByLabelText(/^Memo/), { target: { value: memo } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts a memo of exactly 250 bytes', async () => {
        const composeForConfirm = vi.fn().mockResolvedValue({ psbt: 'aa00' });
        render(
            <MessagingProvider shell='desktop' messaging={messaging(composeForConfirm)}>
                <SwapForm walletId='w' onBack={() => {}} initialChainId={BTC} initialGiveTick='ALPHA' />
            </MessagingProvider>,
        );
        await fillSwap();
        fireEvent.change(screen.getByLabelText(/^Memo/), { target: { value: 'x'.repeat(250) } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    });
});
