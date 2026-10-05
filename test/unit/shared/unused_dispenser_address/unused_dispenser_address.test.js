// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearUnusedDispenserAddresses,
    forgetUnusedDispenserAddress,
    recallUnusedDispenserAddress,
    rememberUnusedDispenserAddress,
} from '../../../../packages/core/src/shared/utils/unusedDispenserAddress.js';

const SCOPE = { walletId: 'wallet-1', accountId: 'account-1', chainId: 'chain-1' };
const RECORD = { address: 'address-1', label: 'Dispenser #1' };

beforeEach(() => {
    clearUnusedDispenserAddresses();
});

describe('unusedDispenserAddress recall', () => {
    it('recalls the same record object while the wallet holds its address', () => {
        rememberUnusedDispenserAddress(SCOPE, RECORD);

        const recalled = recallUnusedDispenserAddress(SCOPE, [
            { address: 'another-address' },
            { address: RECORD.address },
        ]);

        expect(recalled).toBe(RECORD);
    });

    it('returns null when the wallet no longer holds the remembered address', () => {
        rememberUnusedDispenserAddress(SCOPE, RECORD);

        expect(recallUnusedDispenserAddress(SCOPE, [{ address: 'another-address' }])).toBeNull();
        expect(recallUnusedDispenserAddress(SCOPE, undefined)).toBeNull();
    });

    it('keeps wallet, account, and chain scopes separate', () => {
        rememberUnusedDispenserAddress(SCOPE, RECORD);
        const walletAddresses = [{ address: RECORD.address }];

        expect(recallUnusedDispenserAddress({ ...SCOPE, walletId: 'wallet-2' }, walletAddresses)).toBeNull();
        expect(recallUnusedDispenserAddress({ ...SCOPE, accountId: 'account-2' }, walletAddresses)).toBeNull();
        expect(recallUnusedDispenserAddress({ ...SCOPE, chainId: 'chain-2' }, walletAddresses)).toBeNull();
    });

    it.each([
        ['missing record', undefined],
        ['null record', null],
        ['missing address', {}],
        ['empty address', { address: '' }],
        ['non-string address', { address: 42 }],
    ])('stores nothing for a record with %s', (_label, record) => {
        rememberUnusedDispenserAddress(SCOPE, record);

        expect(recallUnusedDispenserAddress(SCOPE, [{ address: record?.address }])).toBeNull();
    });
});

describe('unusedDispenserAddress memory changes', () => {
    it('replaces the remembered record for the same scope', () => {
        const replacement = { address: 'address-2', label: 'Dispenser #2' };
        rememberUnusedDispenserAddress(SCOPE, RECORD);
        rememberUnusedDispenserAddress(SCOPE, replacement);

        expect(recallUnusedDispenserAddress(SCOPE, [{ address: RECORD.address }])).toBeNull();
        expect(recallUnusedDispenserAddress(SCOPE, [{ address: replacement.address }])).toBe(replacement);
    });

    it('forgets the record only when the used address matches', () => {
        const walletAddresses = [{ address: RECORD.address }];
        rememberUnusedDispenserAddress(SCOPE, RECORD);

        forgetUnusedDispenserAddress(SCOPE, 'another-address');
        expect(recallUnusedDispenserAddress(SCOPE, walletAddresses)).toBe(RECORD);
        forgetUnusedDispenserAddress(SCOPE, undefined);
        expect(recallUnusedDispenserAddress(SCOPE, walletAddresses)).toBe(RECORD);
        forgetUnusedDispenserAddress(SCOPE, RECORD.address);
        expect(recallUnusedDispenserAddress(SCOPE, walletAddresses)).toBeNull();
    });

    it('clears remembered records from every scope', () => {
        const otherScope = { ...SCOPE, walletId: 'wallet-2' };
        const otherRecord = { address: 'address-2' };
        rememberUnusedDispenserAddress(SCOPE, RECORD);
        rememberUnusedDispenserAddress(otherScope, otherRecord);

        clearUnusedDispenserAddresses();

        expect(recallUnusedDispenserAddress(SCOPE, [{ address: RECORD.address }])).toBeNull();
        expect(recallUnusedDispenserAddress(otherScope, [{ address: otherRecord.address }])).toBeNull();
    });
});
