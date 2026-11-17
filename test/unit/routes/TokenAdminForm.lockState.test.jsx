// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Lock token form: the token's current lock state loads the moment a token is
// set (preset or picked), locks already on are fixed on, and only the rest move.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const ALL_LOCKS = {
    max_supply: true, max_mint: true, mint: true, mint_supply: true,
    description: true, sleep: true, callback: true,
};

function info(tick, locks) {
    return { chainId: CHAIN, tick, creator: SOURCE.address, locks };
}

function mountLock({ initialTick = 'TOKEN', getTokenInfo, extra = {} } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'AAA', quantity: '10', divisibility: 0 },
                        { tick: 'BBB', quantity: '10', divisibility: 0 },
                    ],
                },
            }],
        }),
        getTokenInfo,
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        ...extra,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode="lock"
                initialChainId={initialTick ? CHAIN : undefined}
                initialTick={initialTick}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

const lockAction = () => screen.getByRole('button', { name: 'Lock Token' });

afterEach(() => {
    cleanup();
    resetWalletModes();
    __clearTokenInfoCache();
});

describe('Lock token form lock state', () => {
    it('loads the preset token state at once: locked on and disabled, the rest togglable', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue(info('TOKEN', { max_supply: true, description: true }));
        mountLock({ getTokenInfo });

        await waitFor(() => expect(screen.getByLabelText(/^Max supply/)).toBeDisabled());
        expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN, tick: 'TOKEN' }));
        expect(screen.getByLabelText(/^Max supply/)).toBeChecked();
        expect(screen.getByLabelText(/^Description/)).toBeChecked();
        expect(screen.getByLabelText(/^Description/)).toBeDisabled();
        expect(screen.getAllByText('Already locked')).toHaveLength(2);

        const callback = screen.getByLabelText('Callback');
        expect(callback).not.toBeChecked();
        expect(callback).toBeEnabled();
        fireEvent.click(callback);
        expect(callback).toBeChecked();
    });

    it('keeps every toggle disabled while the state loads', async () => {
        let resolve;
        const getTokenInfo = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
        mountLock({ getTokenInfo });

        const callback = await screen.findByLabelText('Callback');
        expect(callback).toBeDisabled();
        expect(screen.getByRole('group', { name: 'Lock flags' })).toHaveAttribute('aria-busy', 'true');

        resolve(info('TOKEN', {}));
        await waitFor(() => expect(screen.getByLabelText('Callback')).toBeEnabled());
    });

    it('shows the standard error and keeps toggles disabled when the read fails', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'TOKEN', loadError: true });
        const buildActionPsbtRequest = vi.fn();
        mountLock({ getTokenInfo, extra: { buildActionPsbtRequest } });

        expect(await screen.findByText(/issuer could not be confirmed/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText('Callback')).toBeDisabled());
        expect(screen.getByLabelText(/^Max supply/)).toBeDisabled();
        expect(lockAction()).toBeEnabled();
        fireEvent.click(lockAction());
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('with every lock on: all toggles stay fixed and the enabled action composes nothing', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue(info('TOKEN', ALL_LOCKS));
        const buildActionPsbtRequest = vi.fn();
        mountLock({ getTokenInfo, extra: { buildActionPsbtRequest } });

        expect(await screen.findByText('Everything is already locked.')).toBeInTheDocument();
        const group = screen.getByRole('group', { name: 'Lock flags' });
        const boxes = group.querySelectorAll('input[type="checkbox"]');
        expect(boxes.length).toBe(7);
        boxes.forEach((box) => {
            expect(box).toBeChecked();
            expect(box).toBeDisabled();
        });
        expect(lockAction()).toBeEnabled();
        fireEvent.click(lockAction());
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('switching token reloads its state and resets the toggles', async () => {
        const getTokenInfo = vi.fn().mockImplementation(({ tick }) => Promise.resolve(
            tick === 'AAA' ? info('AAA', { description: true }) : info('BBB', { max_supply: true }),
        ));
        mountLock({ initialTick: '', getTokenInfo });

        fireEvent.click(await screen.findByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select AAA on Bitcoin/ }));
        await waitFor(() => expect(screen.getByLabelText(/^Description/)).toBeDisabled());
        fireEvent.click(screen.getByLabelText('Callback'));
        expect(screen.getByLabelText('Callback')).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select BBB on Bitcoin/ }));
        await waitFor(() => expect(screen.getByLabelText(/^Max supply/)).toBeDisabled());
        expect(screen.getByLabelText(/^Description/)).toBeEnabled();
        expect(screen.getByLabelText(/^Description/)).not.toBeChecked();
        expect(screen.getByLabelText('Callback')).not.toBeChecked();
        expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'BBB' }));
    });

    it('submits only the newly turned-on locks', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff00', chainId: CHAIN });
        const getTokenInfo = vi.fn().mockResolvedValue(info('TOKEN', { max_supply: true }));
        mountLock({ getTokenInfo, extra: { buildActionPsbtRequest } });

        await waitFor(() => expect(screen.getByLabelText(/^Max supply/)).toBeDisabled());
        fireEvent.click(screen.getByLabelText('Callback'));
        fireEvent.click(lockAction());
        fireEvent.change(await screen.findByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        await waitFor(() => expect(buildActionPsbtRequest).toHaveBeenCalled());
        const params = JSON.stringify(buildActionPsbtRequest.mock.calls[0]);
        expect(params).toContain('LOCK_CALLBACK');
        expect(params).not.toContain('LOCK_MAX_SUPPLY');
    });
});
