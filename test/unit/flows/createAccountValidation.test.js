// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createAccount } from '../../../packages/core/src/flows/createAccount.js';

function options(accounts, name) {
    return {
        walletId: 'wallet-1',
        name,
        signer: {},
        vault: {
            wallets: { get: async () => ({ id: 'wallet-1', format: 'bip39' }) },
            accounts: { findBy: async () => accounts },
        },
        chainRegistry: { has: () => true },
        sdkRegistry: {},
        activeChainIds: ['bitcoin-mainnet'],
    };
}

describe('createAccount name validation', () => {
    it('rejects an explicitly blank account name', async () => {
        await expect(createAccount(options([], '   ')))
            .rejects.toThrow('createAccount: name must be a non-empty string');
    });

    it.each(['\u200B', '\u2800'])('rejects the invisible account name %j', async (name) => {
        await expect(createAccount(options([], name)))
            .rejects.toThrow('createAccount: name must be a non-empty string');
    });

    it('rejects an account name over 64 characters', async () => {
        await expect(createAccount(options([], 'x'.repeat(65))))
            .rejects.toThrow('createAccount: name must be 64 characters or fewer');
    });

    it('rejects a name that differs from an existing one only by invisible characters', async () => {
        const accounts = [{ id: 'account-1', walletId: 'wallet-1', index: 0, name: 'Savings' }];

        await expect(createAccount(options(accounts, 'Savings\u200B')))
            .rejects.toThrow('already exists');
    });

    it('rejects an existing account name case-insensitively', async () => {
        const accounts = [{ id: 'account-1', walletId: 'wallet-1', index: 0, name: 'Savings' }];

        await expect(createAccount(options(accounts, ' savings ')))
            .rejects.toThrow('An account named "savings" already exists.');
    });
});
