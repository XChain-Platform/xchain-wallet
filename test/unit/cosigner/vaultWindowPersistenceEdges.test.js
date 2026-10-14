// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    buildAccountWindowStore,
    createVaultWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowPersistence.js';

function account(overrides = {}) {
    return {
        id: 'account-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        policy: { maxPerWindow: { hours: 24 } },
        window: null,
        ...overrides,
    };
}

function vaultReturning(value) {
    return {
        coSignerAccounts: {
            async get() { return value; },
            async put() {},
        },
    };
}

describe('createVaultWindowPersistence edge cases', () => {
    it.each([null, [], 'scope'])('rejects invalid expected scope %j', (expectedScope) => {
        expect(() => createVaultWindowPersistence(vaultReturning(account()), 'account-1', expectedScope))
            .toThrow(/expectedScope/);
    });

    it('rejects an account returned under the wrong id on reads and writes', async () => {
        const persistence = createVaultWindowPersistence(
            vaultReturning(account({ id: 'account-2' })),
            'account-1',
        );

        await expect(persistence.read()).rejects.toThrow(/different account/);
        await expect(persistence.write({ version: 1, entries: [] }))
            .rejects.toThrow(/different account/);
    });

    it.each(['walletId', 'chainId'])('checks expected %s scope on reads', async (field) => {
        const current = account({ [field]: 'changed' });
        const persistence = createVaultWindowPersistence(
            vaultReturning(current),
            current.id,
            { [field]: account()[field] },
        );

        await expect(persistence.read()).rejects.toThrow(new RegExp(`${field} changed`));
    });
});

describe('buildAccountWindowStore edge cases', () => {
    it.each([null, {}, { policy: null }])('requires an account policy for %j', (value) => {
        expect(() => buildAccountWindowStore({ vault: vaultReturning(value), account: value }))
            .toThrow(/account with a policy/);
    });

    it.each(['id', 'walletId', 'chainId'])('requires nonblank account.%s', (field) => {
        const value = account({ [field]: '   ' });
        expect(() => buildAccountWindowStore({ vault: vaultReturning(value), account: value }))
            .toThrow(new RegExp(`account\\.${field}`));
    });

    it.each([false, -1, Number.POSITIVE_INFINITY, '24'])('rejects invalid window hours %j', (hours) => {
        const value = account({ policy: { maxPerWindow: { hours } } });
        expect(() => buildAccountWindowStore({ vault: vaultReturning(value), account: value }))
            .toThrow(/positive number/);
    });

    it.each([null, undefined])('returns null for an absent window cap', (maxPerWindow) => {
        const value = account({ policy: { maxPerWindow } });
        expect(buildAccountWindowStore({ vault: vaultReturning(value), account: value })).toBeNull();
    });
});
