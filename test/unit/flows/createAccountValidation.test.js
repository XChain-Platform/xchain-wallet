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

    it('rejects an existing account name case-insensitively', async () => {
        const accounts = [{ id: 'account-1', walletId: 'wallet-1', index: 0, name: 'Savings' }];

        await expect(createAccount(options(accounts, ' savings ')))
            .rejects.toThrow('An account named "savings" already exists.');
    });
});
