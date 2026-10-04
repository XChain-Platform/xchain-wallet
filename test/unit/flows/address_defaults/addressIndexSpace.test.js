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
import { indexSpaceSharedForWallet } from '../../../../packages/core/src/flows/_addressIndexSpace.js';

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

        await expect(indexSpaceSharedForWallet(vault, 'wallet-1')).resolves.toBe(false);
    });
});
