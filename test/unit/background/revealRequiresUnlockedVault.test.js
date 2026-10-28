// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { revealMnemonic } from '../../../packages/core/src/flows/revealMnemonic.js';
import { exportPrivateKey } from '../../../packages/core/src/flows/exportPrivateKey.js';

function makeLockedHost() {
    const vault = {
        isOpen: false,
        settings: { get: vi.fn(async () => ({})) },
        wallets: { get: vi.fn(), list: vi.fn(async () => []) },
        addresses: { get: vi.fn() },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, vault };
}

describe('secret reveal routes require an unlocked vault', () => {
    it.each([
        ['wallet.revealMnemonic', { walletId: 'wallet-1', password: 'correct-password' }],
        ['wallet.exportPrivateKey', {
            walletId: 'wallet-1',
            addressId: 'address-1',
            password: 'correct-password',
        }],
    ])('refuses %s before reading secret records', async (type, request) => {
        const { host, vault } = makeLockedHost();

        const response = await host.handle({ type, request });

        expect(response).toMatchObject({
            ok: false,
            error: { name: 'WalletLockedError' },
        });
        expect(vault.wallets.get).not.toHaveBeenCalled();
        expect(vault.addresses.get).not.toHaveBeenCalled();
    });
});

describe('the core reveal flows refuse a closed vault themselves', () => {
    function closedVault() {
        return {
            isOpen: false,
            wallets: { get: vi.fn() },
            addresses: { get: vi.fn() },
        };
    }

    it('revealMnemonic', async () => {
        const vault = closedVault();

        await expect(revealMnemonic({ vault, walletId: 'wallet-1', password: 'correct-password' }))
            .rejects.toMatchObject({ name: 'WalletLockedError' });
        expect(vault.wallets.get).not.toHaveBeenCalled();
    });

    it('exportPrivateKey', async () => {
        const vault = closedVault();

        await expect(exportPrivateKey({
            vault,
            walletId: 'wallet-1',
            addressId: 'address-1',
            password: 'correct-password',
        })).rejects.toMatchObject({ name: 'WalletLockedError' });
        expect(vault.wallets.get).not.toHaveBeenCalled();
        expect(vault.addresses.get).not.toHaveBeenCalled();
    });
});
