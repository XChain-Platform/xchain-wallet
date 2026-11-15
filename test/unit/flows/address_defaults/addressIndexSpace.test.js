// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    indexSpaceSharedAcrossTypes,
    indexSpaceSharedForAccount,
    indexSpaceSharedForWallet,
} from '../../../../packages/core/src/flows/_addressIndexSpace.js';

function vaultReturning(wallet) {
    return { wallets: { get: vi.fn().mockResolvedValue(wallet) } };
}

describe('indexSpaceSharedForWallet', () => {
    it('returns true for a stored counterwallet-legacy wallet', async () => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });

        await expect(indexSpaceSharedForWallet(vault, 'wallet-1')).resolves.toBe(true);
        expect(vault.wallets.get).toHaveBeenCalledWith('wallet-1');
    });

    it.each(['bip39', 'wif-only', undefined])(
        'returns false for the nonlegacy format %s',
        async (format) => {
            const vault = vaultReturning({ format });

            await expect(indexSpaceSharedForWallet(vault, 'wallet-1')).resolves.toBe(false);
        },
    );

    it('returns false for a falsy wallet ID without reading the vault', async () => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });

        await expect(indexSpaceSharedForWallet(vault, '')).resolves.toBe(false);
        expect(vault.wallets.get).not.toHaveBeenCalled();
    });

    it('returns false when the wallet lookup returns null', async () => {
        const vault = vaultReturning(null);

        await expect(indexSpaceSharedForWallet(vault, 'missing')).resolves.toBe(false);
    });

    it('returns false when the wallet lookup rejects', async () => {
        const vault = { wallets: { get: vi.fn().mockRejectedValue(new Error('read failed')) } };

        await expect(indexSpaceSharedForWallet(vault, 'wallet-1')).rejects.toThrow('read failed');
    });
});

describe('indexSpaceSharedForAccount', () => {
    const account = { id: 'account-1', index: 0 };

    it('keeps the legacy seed account shared', async () => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });
        await expect(indexSpaceSharedForAccount(vault, 'wallet-1', {
            account, addresses: [{ accountId: account.id, source: 'hd' }], signerKind: 'software',
        })).resolves.toBe(true);
    });

    it.each(['trezor', 'ledger'])('keeps a %s account partitioned by type', async (source) => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });
        await expect(indexSpaceSharedForAccount(vault, 'wallet-1', {
            account, addresses: [{ accountId: account.id, source }], signerKind: source,
        })).resolves.toBe(false);
    });

    it('keeps non-seed legacy accounts partitioned before they hold an address', async () => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });
        await expect(indexSpaceSharedForAccount(vault, 'wallet-1', {
            account: { id: 'account-2', index: 1 }, addresses: [],
        })).resolves.toBe(false);
    });

    it('partitions by the hardware signer alone when the account holds no address yet', async () => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });
        await expect(indexSpaceSharedForAccount(vault, 'wallet-1', {
            account, addresses: [], signerKind: 'trezor',
        })).resolves.toBe(false);
    });

    it('partitions by a held hardware address alone when no signer kind is known', async () => {
        const vault = vaultReturning({ format: 'counterwallet-legacy' });
        await expect(indexSpaceSharedForAccount(vault, 'wallet-1', {
            account, addresses: [{ accountId: account.id, source: 'ledger' }],
        })).resolves.toBe(false);
    });
});

it.each([
    ['counterwallet-legacy', true],
    ['bip39', false],
    ['wif-only', false],
    [undefined, false],
])('identifies whether %s shares one index space', (format, expected) => {
    expect(indexSpaceSharedAcrossTypes(format)).toBe(expected);
});
