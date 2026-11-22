// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The signer-mode Home draws its actions as the shared ActionList (G101):
// Sign a Transaction, Sign a Message, Verify a Signature, Settings and Lock,
// each running its own handler; a sign or verify row whose handler the shell
// did not wire stays as an off row. Home is not a detail page, so it has no
// Actions | Details toggle.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { NavSurfaceContext } from '../../../packages/core/src/shared/components/navSurface.js';

afterEach(() => {
    cleanup();
    resetWalletModes();
});

function renderSignerHome(props, navSurface = null) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet', walletMode: 'signer' }]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
    };
    return render(
        <NavSurfaceContext.Provider value={navSurface}>
            <MessagingProvider shell="web" messaging={messaging}>
                <Home activeWalletId="wallet-1" {...props} />
            </MessagingProvider>
        </NavSurfaceContext.Provider>,
    );
}

describe('signer-mode Home actions (G101)', () => {
    it('draws the signer actions as one ActionList whose rows run their handlers', async () => {
        const handlers = {
            onSignPsbt: vi.fn(),
            onSignMessage: vi.fn(),
            onVerifySignature: vi.fn(),
            onOpenSettings: vi.fn(),
            onLockWallet: vi.fn(),
        };
        renderSignerHome(handlers);
        await screen.findByText('Signer for another phone');

        const region = screen.getByRole('region', { name: 'Signer for another phone home' });
        const list = within(region).getByRole('list', { name: 'Actions' });
        expect(list.tagName).toBe('UL');
        expect(within(list).getAllByRole('listitem')).toHaveLength(5);
        for (const item of within(list).getAllByRole('listitem')) {
            const row = item.querySelector('button');
            expect(row.querySelector('[aria-hidden="true"][data-tone="default"] svg')).toBeTruthy();
            expect(row.getAttribute('data-tone')).toBe('default');
        }

        const press = (name) => fireEvent.click(within(list).getByRole('button', { name }));
        press(/^Sign a Transaction/);
        press(/^Sign a Message/);
        press(/^Verify a Signature/);
        press(/^Settings/);
        press(/^Lock Wallet/);
        for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
        expect(within(list).getByRole('button', { name: /^Sign a Transaction/ }).textContent)
            .toContain('Sign a transaction built on your other phone');
    });

    it('keeps an unwired sign row as an off row that ignores presses', async () => {
        renderSignerHome({ onSignMessage: vi.fn() });
        await screen.findByText('Signer for another phone');

        const psbt = screen.getByRole('button', { name: /^Sign a Transaction/ });
        expect(psbt).toHaveAttribute('aria-disabled', 'true');
        expect(psbt.hasAttribute('disabled')).toBe(false);
        expect(screen.getByRole('button', { name: /^Sign a Message/ })).not.toHaveAttribute('aria-disabled');
        // No Settings or Lock row without their handlers.
        expect(screen.queryByRole('button', { name: /^Lock Wallet/ })).toBeNull();
    });

    // A full-screen extension tab shows the side menu, whose Settings and Lock
    // rows these would repeat; the popup and side panel keep them.
    it.each([
        ['the tab bar', 'tabBar', true],
        ['the side menu', 'sidebar', false],
    ])('offers Settings and Lock beside %s only where no side menu has them', async (_label, surface, shown) => {
        renderSignerHome({ onSignPsbt: vi.fn(), onOpenSettings: vi.fn(), onLockWallet: vi.fn() }, surface);
        await screen.findByText('Signer for another phone');
        const list = screen.getByRole('list', { name: 'Actions' });
        expect(Boolean(within(list).queryByRole('button', { name: /^Settings/ }))).toBe(shown);
        expect(Boolean(within(list).queryByRole('button', { name: /^Lock Wallet/ }))).toBe(shown);
    });
});
