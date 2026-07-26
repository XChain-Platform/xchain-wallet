// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-06: the create-time advanced ISSUE fields (lock matrix, callback
// trio, access lists) folded into the Token Creation Wizard.
//
// These rules matter more than their admin-edit twins: on an edit a
// rejected field costs the edit, but on a create every field shares ONE
// ISSUE, so a single bad value means the token is never created. Two of
// the guards below exist precisely because the indexer's own versions
// are written `tokenInfo && ...` and therefore do NOT run on a create.

import { describe, it, expect } from 'vitest';
import {
    LOCK_FLAGS,
    applyAdvancedIssueFields,
    validateAdvancedIssueFields,
    advancedIssueWarnings,
    fractionalDigits,
} from '../../../../packages/core/src/shared/utils/issueAdvancedFields.js';

// The seven ISSUE lock flags and their wire fields, pinned against
// xchain-indexer/src/actions/issue.js `fieldList['LOCK']`.
const EXPECTED_LOCKS = {
    max_supply: 'LOCK_MAX_SUPPLY',
    max_mint: 'LOCK_MAX_MINT',
    mint: 'LOCK_MINT',
    mint_supply: 'LOCK_MINT_SUPPLY',
    description: 'LOCK_DESCRIPTION',
    sleep: 'LOCK_SLEEP',
    callback: 'LOCK_CALLBACK',
};

describe('LOCK_FLAGS', () => {
    it('carries all seven flags with their wire fields and a permanence hint', () => {
        expect(LOCK_FLAGS).toHaveLength(7);
        for (const f of LOCK_FLAGS) {
            expect(EXPECTED_LOCKS[f.key]).toBe(f.field);
            expect(f.label.length).toBeGreaterThan(0);
            expect(f.hint.length).toBeGreaterThan(0);
        }
        expect(Object.keys(EXPECTED_LOCKS).sort())
            .toEqual(LOCK_FLAGS.map((f) => f.key).sort());
    });
});

describe('applyAdvancedIssueFields', () => {
    it('emits one LOCK_* field per checked flag', () => {
        const p = applyAdvancedIssueFields({}, {
            lockChecks: { max_supply: true, callback: true },
        });
        expect(p).toEqual({ LOCK_MAX_SUPPLY: '1', LOCK_CALLBACK: '1' });
    });

    it('emits nothing for unchecked flags rather than an explicit zero', () => {
        // An explicit LOCK_MAX_SUPPLY=0 is a shape the indexer has had
        // to special-case before (LOCK_MAX_SUPPLY_EXACT); at create
        // there is no prior value to preserve, so absent is correct.
        const p = applyAdvancedIssueFields({}, {
            lockChecks: { max_supply: false, mint: undefined },
        });
        expect(p).toEqual({});
    });

    it('emits the callback trio, uppercasing the ticker', () => {
        const p = applyAdvancedIssueFields({}, {
            callbackTick: ' xchain ',
            callbackAmount: '2.5',
            callbackBlock: '900100',
        });
        expect(p).toEqual({
            CALLBACK_TICK: 'XCHAIN',
            CALLBACK_AMOUNT: '2.5',
            CALLBACK_BLOCK: '900100',
        });
    });

    it('emits the bound access lists', () => {
        const p = applyAdvancedIssueFields({}, { allowListIdx: '412', blockListIdx: '77' });
        expect(p).toEqual({ ALLOW_LIST: '412', BLOCK_LIST: '77' });
    });

    it('leaves the params untouched for a blank or absent advanced set', () => {
        expect(applyAdvancedIssueFields({ TICK: 'A' }, null)).toEqual({ TICK: 'A' });
        expect(applyAdvancedIssueFields({ TICK: 'A' }, undefined)).toEqual({ TICK: 'A' });
        expect(applyAdvancedIssueFields({ TICK: 'A' }, {
            lockChecks: {},
            callbackTick: '',
            callbackAmount: '  ',
            callbackBlock: '',
            allowListIdx: null,
            blockListIdx: undefined,
        })).toEqual({ TICK: 'A' });
    });

    it('never clobbers a field the base composer already set', () => {
        // `lockOnCreate` sets LOCK_MAX_SUPPLY + LOCK_MINT before the
        // advanced fields apply; both paths converge on '1'.
        const p = applyAdvancedIssueFields(
            { LOCK_MAX_SUPPLY: '1', LOCK_MINT: '1' },
            { lockChecks: { max_supply: true, description: true } },
        );
        expect(p).toEqual({
            LOCK_MAX_SUPPLY: '1',
            LOCK_MINT: '1',
            LOCK_DESCRIPTION: '1',
        });
    });

    it('composes the full advanced set into exactly the ISSUE v0 field names', () => {
        const p = applyAdvancedIssueFields({ VERSION: '0', TICK: 'DEMO' }, {
            lockChecks: Object.fromEntries(LOCK_FLAGS.map((f) => [f.key, true])),
            callbackTick: 'XCHAIN',
            callbackAmount: '1',
            callbackBlock: '1000',
            allowListIdx: '5',
            blockListIdx: '6',
        });
        expect(Object.keys(p).sort()).toEqual([
            'ALLOW_LIST', 'BLOCK_LIST',
            'CALLBACK_AMOUNT', 'CALLBACK_BLOCK', 'CALLBACK_TICK',
            'LOCK_CALLBACK', 'LOCK_DESCRIPTION', 'LOCK_MAX_MINT',
            'LOCK_MAX_SUPPLY', 'LOCK_MINT', 'LOCK_MINT_SUPPLY', 'LOCK_SLEEP',
            'TICK', 'VERSION',
        ]);
    });
});

describe('validateAdvancedIssueFields', () => {
    const OK = { supply: '1000', currentHeight: 900000, callbackTickDecimals: null };

    it('accepts an empty advanced set', () => {
        expect(validateAdvancedIssueFields(null, OK)).toBeNull();
        expect(validateAdvancedIssueFields({}, OK)).toBeNull();
    });

    it('rejects a half-built callback in every partial shape', () => {
        const partials = [
            { callbackTick: 'XCHAIN' },
            { callbackAmount: '1' },
            { callbackBlock: '900100' },
            { callbackTick: 'XCHAIN', callbackAmount: '1' },
            { callbackTick: 'XCHAIN', callbackBlock: '900100' },
            { callbackAmount: '1', callbackBlock: '900100' },
        ];
        for (const advanced of partials) {
            expect(validateAdvancedIssueFields(advanced, OK)).toMatch(/all three/i);
        }
    });

    it('accepts a complete callback with a future block and a whole amount', () => {
        expect(validateAdvancedIssueFields({
            callbackTick: 'XCHAIN', callbackAmount: '1', callbackBlock: '900001',
        }, OK)).toBeNull();
    });

    it('rejects a callback block at or below the tip, which the indexer does not check on a create', () => {
        // issue.js gates its future-block guard on `tokenInfo`, so on a
        // create a past block is accepted on-chain and the callback is
        // live the moment the token exists.
        const base = { callbackTick: 'XCHAIN', callbackAmount: '1' };
        expect(validateAdvancedIssueFields({ ...base, callbackBlock: '899999' }, OK))
            .toMatch(/must be in the future/i);
        expect(validateAdvancedIssueFields({ ...base, callbackBlock: '900000' }, OK))
            .toMatch(/must be in the future/i);
        expect(validateAdvancedIssueFields({ ...base, callbackBlock: '900001' }, OK))
            .toBeNull();
    });

    it('does not block the callback block when the tip is unknown', () => {
        expect(validateAdvancedIssueFields({
            callbackTick: 'XCHAIN', callbackAmount: '1', callbackBlock: '1',
        }, { ...OK, currentHeight: null })).toBeNull();
    });

    it('rejects a non-whole callback block', () => {
        expect(validateAdvancedIssueFields({
            callbackTick: 'XCHAIN', callbackAmount: '1', callbackBlock: '900100.5',
        }, OK)).toMatch(/whole block height/i);
    });

    it('rejects a malformed callback ticker', () => {
        expect(validateAdvancedIssueFields({
            callbackTick: 'BAD TICK', callbackAmount: '1', callbackBlock: '900100',
        }, OK)).toMatch(/valid ticker/i);
    });

    it('rejects a non-positive callback payout', () => {
        for (const callbackAmount of ['0', '-1', 'abc']) {
            expect(validateAdvancedIssueFields({
                callbackTick: 'XCHAIN', callbackAmount, callbackBlock: '900100',
            }, OK)).toMatch(/positive number/i);
        }
    });

    it('holds a fractional payout to whole numbers until the callback token is proven divisible', () => {
        // The indexer prices CALLBACK_AMOUNT in the CALLBACK token's
        // decimals and falls back to 0 when that token does not exist
        // (issue.js `callback_decimals`), which would invalidate the
        // whole ISSUE.
        const advanced = {
            callbackTick: 'XCHAIN', callbackAmount: '0.5', callbackBlock: '900100',
        };
        expect(validateAdvancedIssueFields(advanced, { ...OK, callbackTickDecimals: null }))
            .toMatch(/whole number/i);
        expect(validateAdvancedIssueFields(advanced, { ...OK, callbackTickDecimals: 8 }))
            .toBeNull();
    });

    it('rejects a payout finer than the callback token divisibility, at the boundary', () => {
        const at = { callbackTick: 'X', callbackAmount: '0.12', callbackBlock: '900100' };
        const past = { callbackTick: 'X', callbackAmount: '0.123', callbackBlock: '900100' };
        expect(validateAdvancedIssueFields(at, { ...OK, callbackTickDecimals: 2 })).toBeNull();
        expect(validateAdvancedIssueFields(past, { ...OK, callbackTickDecimals: 2 }))
            .toMatch(/only has 2/);
    });

    it('accepts a whole payout against an indivisible callback token', () => {
        expect(validateAdvancedIssueFields({
            callbackTick: 'X', callbackAmount: '3', callbackBlock: '900100',
        }, { ...OK, callbackTickDecimals: 0 })).toBeNull();
    });

    it('rejects locking max supply with no supply declared', () => {
        const advanced = { lockChecks: { max_supply: true } };
        expect(validateAdvancedIssueFields(advanced, { ...OK, supply: '' }))
            .toMatch(/needs a supply/i);
        expect(validateAdvancedIssueFields(advanced, { ...OK, supply: '1000' })).toBeNull();
    });

    it('leaves the other six locks unguarded, matching the chain', () => {
        // Only LOCK_MAX_SUPPLY has a create-time precondition in
        // issue.js; the rest are legal on any create.
        const advanced = {
            lockChecks: Object.fromEntries(
                LOCK_FLAGS.filter((f) => f.key !== 'max_supply').map((f) => [f.key, true]),
            ),
        };
        expect(validateAdvancedIssueFields(advanced, { ...OK, supply: '' })).toBeNull();
    });
});

describe('advancedIssueWarnings', () => {
    it('flags locking the callback with nothing configured', () => {
        const out = advancedIssueWarnings({ lockChecks: { callback: true } });
        expect(out.join(' ')).toMatch(/never be able to have one/i);
    });

    it('flags locking a callback that IS configured, in its own words', () => {
        const out = advancedIssueWarnings({
            lockChecks: { callback: true },
            callbackTick: 'XCHAIN', callbackAmount: '1', callbackBlock: '900100',
        });
        expect(out.join(' ')).toMatch(/can never be changed again/i);
        expect(out.join(' ')).not.toMatch(/never be able to have one/i);
    });

    it('flags a fixed supply and a bound allow-list', () => {
        const out = advancedIssueWarnings({
            lockChecks: { mint: true, mint_supply: true },
            allowListIdx: '9',
        });
        expect(out.join(' ')).toMatch(/supply is fixed/i);
        expect(out.join(' ')).toMatch(/ONLY addresses on that list/);
    });

    it('is silent for an untouched advanced set', () => {
        expect(advancedIssueWarnings(null)).toEqual([]);
        expect(advancedIssueWarnings({})).toEqual([]);
    });
});

describe('fractionalDigits', () => {
    it('counts fractional digits, trailing zeros included', () => {
        expect(fractionalDigits('1')).toBe(0);
        expect(fractionalDigits('1.')).toBe(0);
        expect(fractionalDigits('1.5')).toBe(1);
        expect(fractionalDigits('1.250')).toBe(3);
        expect(fractionalDigits('')).toBe(0);
    });
});
