// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural test for  leg 2: the Add-Wallet lane entered from
// inside the demo.
//
// The vault has ONE password. `meta.kdfParams` is written when the vault
// is created, and in the demo funnel that was the demo, using a random
// throwaway password the user never saw. A real wallet added into that
// vault carries the user's chosen password on its own encryptedSeed but
// sits inside a container that still answers only to the demo's, so the
// moment the demo exits (or its 24h auto-wipe fires) the chosen password
// is refused and the wallet is unreachable on that device.
//
// So the lane refuses to grow a demo vault: it clears the demo first,
// records which lane the user picked, and lets the reload land them in a
// clean vault keyed to their own password.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { takePostDemoIntent } from '../../../packages/core/src/shared/utils/demoGraduation.js';

const DEMO_ID_KEY = 'xc:demoWalletId';
const META_KEY = 'xchain-wallet:vault-meta';

function acceptLicense() {
    globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
}

function mount({ messaging = {}, ...props } = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Onboarding, {
                onCreate() {},
                onImport() {},
                onImportFromFreeWallet() {},
                onBack() {},
                ...props,
            }),
        ),
    );
}

let reloadCount;

beforeEach(() => {
    globalThis.localStorage?.clear?.();
    acceptLicense();
    reloadCount = 0;
    // jsdom refuses to let location.reload be assigned, so swap the whole
    // accessor for the duration of the test.
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { reload: () => { reloadCount += 1; } },
    });
});

afterEach(() => {
    cleanup();
    delete globalThis.location;
});

describe('Onboarding add-wallet lane inside the demo', () => {
    it('replaces the create/import fork with the graduation gate', () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        mount({ mode: 'add' });

        expect(screen.getByText('Leave the demo first')).toBeInTheDocument();
        // The plain create/import buttons are gone; every lane now says it
        // clears the demo, so nothing offers to add into the demo vault.
        expect(screen.queryByRole('button', { name: /^Create new wallet$/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear demo & create new wallet/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear demo & import wallet/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Keep exploring the demo/ })).toBeInTheDocument();
    });

    it('leaves the normal add-wallet lane alone when no demo is running', () => {
        mount({ mode: 'add' });
        expect(screen.queryByText('Leave the demo first')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create new wallet/ })).toBeInTheDocument();
    });

    it('leaves the fresh-install lane alone even with a stale demo flag', () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        mount({ mode: 'fresh', onBack: undefined });
        expect(screen.queryByText('Leave the demo first')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create new wallet/ })).toBeInTheDocument();
    });

    it('clears the demo, wipes the vault meta, and hands the picked lane across the reload', async () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        globalThis.localStorage.setItem(META_KEY, '{"kdfParams":"demo"}');
        const removeWallet = vi.fn(async () => {});
        mount({ mode: 'add', messaging: { removeWallet, listWallets: async () => [] } });

        fireEvent.click(screen.getByRole('button', { name: /Clear demo & import wallet/ }));

        await waitFor(() => expect(reloadCount).toBe(1));
        expect(removeWallet).toHaveBeenCalledWith({ walletId: 'demo-1' });
        // The vault meta is what the shell reads as "a wallet exists".
        // Leaving it behind is what bricked the device in leg 1.
        expect(globalThis.localStorage.getItem(META_KEY)).toBe(null);
        expect(globalThis.localStorage.getItem(DEMO_ID_KEY)).toBe(null);
        expect(takePostDemoIntent()).toBe('import');
    });

    it('never wipes a vault that still holds a real wallet, and lets that lane continue', async () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        globalThis.localStorage.setItem(META_KEY, '{"kdfParams":"demo"}');
        const onCreate = vi.fn();
        mount({
            mode: 'add',
            onCreate,
            messaging: {
                removeWallet: async () => {},
                listWallets: async () => [{ id: 'real-1' }],
            },
        });

        fireEvent.click(screen.getByRole('button', { name: /Clear demo & create new wallet/ }));

        await waitFor(() => expect(onCreate).toHaveBeenCalled());
        expect(reloadCount).toBe(0);
        expect(globalThis.localStorage.getItem(META_KEY)).toBe('{"kdfParams":"demo"}');
        expect(takePostDemoIntent()).toBe(null);
    });

    it('says so rather than waving the user through when the vault cannot be read', async () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        globalThis.localStorage.setItem(META_KEY, '{"kdfParams":"demo"}');
        const onCreate = vi.fn();
        mount({
            mode: 'add',
            onCreate,
            messaging: {
                removeWallet: async () => {},
                listWallets: async () => { throw new Error('vault locked'); },
            },
        });

        fireEvent.click(screen.getByRole('button', { name: /Clear demo & create new wallet/ }));

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByRole('alert').textContent).toMatch(/Could not confirm/);
        expect(onCreate).not.toHaveBeenCalled();
        expect(reloadCount).toBe(0);
        expect(globalThis.localStorage.getItem(META_KEY)).toBe('{"kdfParams":"demo"}');
    });

    it('surfaces a failed demo removal instead of pretending it worked', async () => {
        globalThis.localStorage.setItem(DEMO_ID_KEY, 'demo-1');
        globalThis.localStorage.setItem(META_KEY, '{"kdfParams":"demo"}');
        mount({
            mode: 'add',
            messaging: {
                removeWallet: async () => { throw new Error('vault is locked'); },
                listWallets: async () => [],
            },
        });

        fireEvent.click(screen.getByRole('button', { name: /Clear demo & create new wallet/ }));

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByRole('alert').textContent).toMatch(/vault is locked/);
        expect(reloadCount).toBe(0);
        expect(globalThis.localStorage.getItem(META_KEY)).toBe('{"kdfParams":"demo"}');
    });
});
