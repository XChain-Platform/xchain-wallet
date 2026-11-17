// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __createWebVaultMultiTabHarnessForTests } from '../../../packages/web/src/hostBridge.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    subscribeActiveWallet,
    writeActiveWallet,
} from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function expectRouteBlocksAnotherTab(type) {
    const harness = __createWebVaultMultiTabHarnessForTests();
    const first = harness.createTab();
    const second = harness.createTab();
    const network = deferred();

    await first.acquire();
    const route = first.dispatch(type, () => network.promise);
    await first.release();

    expect(first.state()).toEqual({ hasLease: true, releaseDeferred: true });
    await expect(second.acquire()).rejects.toThrow('already open in another tab');

    network.resolve('broadcast');
    await expect(route).resolves.toBe('broadcast');
    await first.whenReleased();
    await expect(second.acquire()).resolves.toBeUndefined();
}

describe('web multi-tab safety', () => {
    beforeEach(() => localStorage.clear());

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('refuses a second unlocked session until the first tab releases its lease', async () => {
        const harness = __createWebVaultMultiTabHarnessForTests();
        const first = harness.createTab();
        const second = harness.createTab();

        await first.acquire();
        await expect(second.acquire()).rejects.toThrow('already open in another tab');
        await first.release();
        await expect(second.acquire()).resolves.toBeUndefined();
    });

    it('holds the lease through a replacement transaction broadcast', async () => {
        await expectRouteBlocksAnotherTab('tx.replace');
    });

    it('holds the lease through a multisig finalization broadcast', async () => {
        await expectRouteBlocksAnotherTab('multisigSign.finalize');
    });

    it('publishes the selected wallet name to a locked tab', () => {
        const onChange = vi.fn();
        const unsubscribe = subscribeActiveWallet(onChange);

        writeActiveWallet('wallet-2', 'Savings');
        window.dispatchEvent(new StorageEvent('storage', { key: 'xc:activeWallet' }));

        expect(onChange).toHaveBeenCalledWith({ id: 'wallet-2', name: 'Savings' });
        unsubscribe();
    });

    it('keeps the locked tab heading on the product name when the active tab switches wallets', () => {
        writeActiveWallet('wallet-1', 'Primary');
        const messaging = {
            unlockWallet: vi.fn(),
            listWallets: vi.fn(async () => { throw new Error('wallet is locked'); }),
        };
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Locked, { onUnlocked: vi.fn() }),
        ));

        // The logo is the only visible brand. The hidden product h1 remains
        // stable, and no wallet name appears before or after the tab switch.
        expect(screen.getByRole('heading', { name: 'XChain Wallet', hidden: true }))
            .toHaveClass('sr-only');
        expect(screen.queryByText('Primary')).toBeNull();
        writeActiveWallet('wallet-2', 'Savings');
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'xc:activeWallet' })));

        expect(screen.getByRole('heading', { name: 'XChain Wallet', hidden: true }))
            .toHaveClass('sr-only');
        expect(screen.queryByText('Savings')).toBeNull();
        expect(screen.queryByText('Primary')).toBeNull();
    });
});
