// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Phase F — pure mapping tests for the inline consent disclosure
// labels. permissionsToVerbs + bpsToPercent are the only logic the
// ContractConsentPanel relies on, so a regression here is a regression
// in what users are shown a contract is allowed to do before they sign.

import { describe, it, expect } from 'vitest';
import {
    permissionsToVerbs,
    bpsToPercent,
    KNOWN_ACTION_TYPES,
} from '../../../packages/core/src/shared/utils/contractConsentLabels.js';

describe('permissionsToVerbs', () => {
    it('null → null (unrestricted / undeclared)', () => {
        expect(permissionsToVerbs(null)).toBeNull();
        expect(permissionsToVerbs(undefined)).toBeNull();
    });

    it('non-array → null (defensive)', () => {
        expect(permissionsToVerbs(/** @type {any} */ ('SEND'))).toBeNull();
        expect(permissionsToVerbs(/** @type {any} */ ({}))).toBeNull();
    });

    it('empty array → empty array (declared but allows nothing)', () => {
        expect(permissionsToVerbs([])).toEqual([]);
    });

    it('maps known action types to plain verbs', () => {
        expect(permissionsToVerbs(['SEND'])).toEqual(['send your tokens']);
        expect(permissionsToVerbs(['ISSUE'])).toEqual(['issue tokens']);
        expect(permissionsToVerbs(['DISPENSER'])).toEqual(['run dispensers']);
        expect(permissionsToVerbs(['EXECUTE'])).toEqual(['call other contracts']);
    });

    it('is case-insensitive on the action token', () => {
        expect(permissionsToVerbs(['send'])).toEqual(['send your tokens']);
        expect(permissionsToVerbs([' Mint '])).toEqual(['mint tokens']);
    });

    it('sorts the rendered verbs alphabetically', () => {
        // SEND → "send your tokens", ISSUE → "issue tokens", MINT → "mint tokens"
        expect(permissionsToVerbs(['SEND', 'ISSUE', 'MINT'])).toEqual([
            'issue tokens',
            'mint tokens',
            'send your tokens',
        ]);
    });

    it('de-duplicates verbs (same action twice, or distinct actions sharing a verb)', () => {
        expect(permissionsToVerbs(['SEND', 'SEND'])).toEqual(['send your tokens']);
    });

    it('drops blank / non-string entries', () => {
        expect(permissionsToVerbs(['SEND', '', '   ', /** @type {any} */ (null), /** @type {any} */ (5)]))
            .toEqual(['send your tokens']);
    });

    it('humanizes an unknown action token rather than dropping it', () => {
        expect(permissionsToVerbs(['FUTURE_ACTION'])).toEqual(['future action']);
        expect(permissionsToVerbs(['NEW-THING'])).toEqual(['new thing']);
    });

    it('covers every protocol action type with a non-empty verb', () => {
        for (const action of KNOWN_ACTION_TYPES) {
            const [verb] = permissionsToVerbs([action]);
            expect(typeof verb).toBe('string');
            expect(verb.length).toBeGreaterThan(0);
            // A mapped verb is never just the lower-cased token unless we
            // deliberately chose that; the guard here is just non-empty.
        }
    });
});

describe('bpsToPercent', () => {
    it('null / undefined → null (no declared cap)', () => {
        expect(bpsToPercent(null)).toBeNull();
        expect(bpsToPercent(undefined)).toBeNull();
    });

    it('whole-percent basis points render without decimals', () => {
        expect(bpsToPercent(300)).toBe('3%');
        expect(bpsToPercent(100)).toBe('1%');
        expect(bpsToPercent(0)).toBe('0%');
        expect(bpsToPercent(10000)).toBe('100%');
    });

    it('fractional-percent basis points keep up to 2 decimals, trimmed', () => {
        expect(bpsToPercent(1250)).toBe('12.5%');
        expect(bpsToPercent(25)).toBe('0.25%');
        expect(bpsToPercent(5)).toBe('0.05%');
    });

    it('negative / non-finite → null (defensive)', () => {
        expect(bpsToPercent(-1)).toBeNull();
        expect(bpsToPercent(Number.NaN)).toBeNull();
        expect(bpsToPercent(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('accepts numeric strings (coerced)', () => {
        expect(bpsToPercent(/** @type {any} */ ('300'))).toBe('3%');
    });
});
