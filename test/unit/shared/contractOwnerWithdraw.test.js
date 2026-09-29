// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// contractOwnerWithdraw reads the explorer's derived owner_withdraw and
// nothing else: the wallet never restates the OWNER_WITHDRAW_OPT_IN rule, and
// any value that is not a real boolean is unknown so a caller keeps its
// behaviour from before the field existed.

import { describe, it, expect } from 'vitest';
import { contractOwnerWithdraw } from '../../../packages/core/src/shared/routes/contractResponseShape.js';

describe('contractOwnerWithdraw', () => {
    it('passes the explorer\'s boolean through', () => {
        expect(contractOwnerWithdraw({ owner_withdraw: true })).toBe(true);
        expect(contractOwnerWithdraw({ owner_withdraw: false })).toBe(false);
        expect(contractOwnerWithdraw({ OWNER_WITHDRAW: false })).toBe(false);
    });

    it('reads an absent or null field as unknown', () => {
        expect(contractOwnerWithdraw({ action_index: '1' })).toBeNull();
        expect(contractOwnerWithdraw({ owner_withdraw: null })).toBeNull();
        expect(contractOwnerWithdraw(null)).toBeNull();
        expect(contractOwnerWithdraw(undefined)).toBeNull();
    });

    it('does not guess from a non-boolean value', () => {
        expect(contractOwnerWithdraw({ owner_withdraw: 'false' })).toBeNull();
        expect(contractOwnerWithdraw({ owner_withdraw: 0 })).toBeNull();
        expect(contractOwnerWithdraw({ owner_withdraw: 1 })).toBeNull();
    });

    it('does not read the author\'s meta, only the explorer\'s derivation', () => {
        expect(contractOwnerWithdraw({ meta: { ownerWithdraw: true } })).toBeNull();
    });
});
