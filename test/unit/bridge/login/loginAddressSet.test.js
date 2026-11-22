// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    LOGIN_PROOF_LIMIT,
    selectLoginAddresses,
} from '../../../../packages/extension/src/bridge/loginAddressSet.js';

const grant = (addresses) => ({ permissions: { addresses } });

describe('selectLoginAddresses', () => {
    it('returns five qualified addresses without truncation', () => {
        const requested = ['a', 'b', 'c', 'd', 'e'];

        expect(LOGIN_PROOF_LIMIT).toBe(5);
        expect(selectLoginAddresses(requested, grant(requested))).toEqual({
            addresses: requested,
            truncated: false,
        });
    });

    it('caps six qualified addresses at five and reports truncation', () => {
        const requested = ['a', 'b', 'c', 'd', 'e', 'f'];

        expect(selectLoginAddresses(requested, grant(requested))).toEqual({
            addresses: ['a', 'b', 'c', 'd', 'e'],
            truncated: true,
        });
    });

    it('preserves request order while dropping duplicates and non-strings', () => {
        const requested = ['third', 42, 'first', 'third', null, 'second', 'first'];

        expect(selectLoginAddresses(requested, grant(['first', 'second', 'third']))).toEqual({
            addresses: ['third', 'first', 'second'],
            truncated: false,
        });
    });

    it('keeps all unique requested strings for a null grant', () => {
        expect(selectLoginAddresses(['a', 'b', 'a', false, 'c'], null)).toEqual({
            addresses: ['a', 'b', 'c'],
            truncated: false,
        });
    });

    it('qualifies nothing for an empty grant', () => {
        expect(selectLoginAddresses(['a'], grant([]))).toEqual({
            addresses: [],
            truncated: false,
        });
    });

    it('does not add granted addresses that were not requested', () => {
        expect(selectLoginAddresses(['requested'], grant(['extra', 'requested']))).toEqual({
            addresses: ['requested'],
            truncated: false,
        });
    });
});
