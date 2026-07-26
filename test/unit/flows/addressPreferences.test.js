// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-32: ADDRESS v0 preferences flow. The two rails under test:
//   1. WRITE-ALL-THREE: the compose refuses a blank FEE_PREFERENCE /
//      REQUIRE_MEMO / DISPENSER_PREFERENCE, because on the wire a blank is
//      not "keep current" - the indexer folds it back as 0 for the first
//      two (Number(null)), silently reverting the prior setting.
//   2. CONSENSUS-FOLD READ: currentAddressPreferences must reproduce the
//      indexer's getAddressPreferences fold exactly, including the footgun
//      (null fee/require overwrite to 0; null dispenser preserved).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'addr-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
    assertValidDestination: vi.fn(),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    addressPreferencesAction,
    currentAddressPreferences,
} from '../../../packages/core/src/flows/addressPreferences.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
function base(extra = {}) {
    return {
        vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
        chainId: 'c', from: FROM,
        params: { FEE_PREFERENCE: '2', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '1' },
        ...extra,
    };
}

describe('addressPreferencesAction (PC-32)', () => {
    beforeEach(() => submitAction.mockClear());

    it('composes ADDRESS v0 with all three fields, always', async () => {
        await addressPreferencesAction(base({
            params: { FEE_PREFERENCE: '1', REQUIRE_MEMO: '1', DISPENSER_PREFERENCE: '2', MEMO: 'hi' },
        }));
        const arg = submitAction.mock.calls[0][0];
        expect(arg.actionData).toEqual({
            action: 'ADDRESS',
            params: {
                VERSION: '0',
                FEE_PREFERENCE: '1',
                REQUIRE_MEMO: '1',
                DISPENSER_PREFERENCE: '2',
                MEMO: 'hi',
            },
        });
    });

    it('omits MEMO when not given (blank memo is fine; blank prefs are not)', async () => {
        await addressPreferencesAction(base());
        const arg = submitAction.mock.calls[0][0];
        expect('MEMO' in arg.actionData.params).toBe(false);
    });

    for (const field of ['FEE_PREFERENCE', 'REQUIRE_MEMO', 'DISPENSER_PREFERENCE']) {
        it(`refuses a blank ${field} (write-all-three rail)`, async () => {
            const params = { FEE_PREFERENCE: '2', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '1' };
            delete params[field];
            await expect(addressPreferencesAction(base({ params })))
                .rejects.toThrow(new RegExp(field));
            expect(submitAction).not.toHaveBeenCalled();
        });
    }

    it('refuses FEE_PREFERENCE 3: documented once, but consensus validValues is {0,1,2}', async () => {
        await expect(addressPreferencesAction(base({
            params: { FEE_PREFERENCE: '3', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '1' },
        }))).rejects.toThrow(/FEE_PREFERENCE/);
    });

    it('refuses DISPENSER_PREFERENCE 0 (valid set is {1,2})', async () => {
        await expect(addressPreferencesAction(base({
            params: { FEE_PREFERENCE: '2', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '0' },
        }))).rejects.toThrow(/DISPENSER_PREFERENCE/);
    });

    it('threads payFeeInNativeCoin into encoderOpts (PC-51), omitting when unset', async () => {
        await addressPreferencesAction(base({ payFeeInNativeCoin: true }));
        expect(submitAction.mock.calls[0][0].encoderOpts.payFeeInNativeCoin).toBe(true);
        submitAction.mockClear();
        await addressPreferencesAction(base());
        expect('payFeeInNativeCoin' in submitAction.mock.calls[0][0].encoderOpts).toBe(false);
    });
});

function sdkWith(rows) {
    return { get: () => ({ getAddresses: async () => ({ data: rows }) }) };
}

describe('currentAddressPreferences consensus fold (PC-32)', () => {
    it('returns protocol defaults with onChain=false when no rows exist', async () => {
        const p = await currentAddressPreferences({ sdkRegistry: sdkWith([]), chainId: 'c', address: 'a' });
        expect(p).toEqual({ feePreference: 2, requireMemo: 0, dispenserPreference: 1, onChain: false });
    });

    it('folds the newest valid row over older ones in action_index order', async () => {
        // Delivered out of order on purpose: the fold must sort ascending.
        const p = await currentAddressPreferences({
            sdkRegistry: sdkWith([
                { action_index: 9, status: 'valid', fee_preference: 1, require_memo: 1, dispenser_preference: 2 },
                { action_index: 3, status: 'valid', fee_preference: 2, require_memo: 0, dispenser_preference: 1 },
            ]),
            chainId: 'c', address: 'a',
        });
        expect(p).toEqual({ feePreference: 1, requireMemo: 1, dispenserPreference: 2, onChain: true });
    });

    it('reproduces the revert footgun: a null fee/require row reads back as 0', async () => {
        const p = await currentAddressPreferences({
            sdkRegistry: sdkWith([
                { action_index: 1, status: 'valid', fee_preference: 1, require_memo: 1, dispenser_preference: 2 },
                { action_index: 2, status: 'valid', fee_preference: null, require_memo: null, dispenser_preference: null },
            ]),
            chainId: 'c', address: 'a',
        });
        // fee/require reverted to 0 by the blank row; dispenser null-guard keeps 2.
        expect(p).toEqual({ feePreference: 0, requireMemo: 0, dispenserPreference: 2, onChain: true });
    });

    it('skips invalid rows entirely', async () => {
        const p = await currentAddressPreferences({
            sdkRegistry: sdkWith([
                { action_index: 1, status: 'valid', fee_preference: 1, require_memo: 0, dispenser_preference: 1 },
                { action_index: 2, status: 'invalid: FEE_PREFERENCE (value)', fee_preference: 3, require_memo: 1, dispenser_preference: 2 },
            ]),
            chainId: 'c', address: 'a',
        });
        expect(p).toEqual({ feePreference: 1, requireMemo: 0, dispenserPreference: 1, onChain: true });
    });

    it('tolerates a bare-array envelope', async () => {
        const sdkRegistry = { get: () => ({ getAddresses: async () => ([
            { action_index: 1, status: 'valid', fee_preference: 2, require_memo: 1, dispenser_preference: 1 },
        ]) }) };
        const p = await currentAddressPreferences({ sdkRegistry, chainId: 'c', address: 'a' });
        expect(p.requireMemo).toBe(1);
        expect(p.onChain).toBe(true);
    });
});
