// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The co-sign approval alert names a policy violation in plain words, so every
// code the SDK policy evaluator can deny with needs a clause, and the clause
// must never carry the raw code back into the sentence a signer reads.

import { describe, it, expect } from 'vitest';
import { describePolicyReason } from '../../../packages/core/src/shared/components/coSignPolicyReasons.js';

// Every deny code in xchain-sdk src/cosigner/policy_evaluator/evaluate_policy.js.
const SDK_CODES = [
    'POLICY_UNRESOLVED_TICK',
    'POLICY_TICK_CASE_COLLISION',
    'POLICY_AMOUNT_INVALID',
    'POLICY_ACTION_DENIED',
    'POLICY_DESTINATION_UNENFORCEABLE',
    'POLICY_UNRESOLVED_DESTINATION',
    'POLICY_DESTINATION_DENIED',
    'POLICY_UNBOUNDED_ACTION',
    'POLICY_AMOUNT_EXCEEDED',
    'POLICY_WINDOW_COUNT_EXCEEDED',
    'POLICY_WINDOW_AMOUNT_EXCEEDED',
];

describe('describePolicyReason', () => {
    it.each(SDK_CODES)('gives %s a plain clause that does not echo the code', (code) => {
        const clause = describePolicyReason(code);
        expect(typeof clause).toBe('string');
        expect(clause.length).toBeGreaterThan(0);
        expect(clause).not.toContain(code);
        expect(clause).not.toMatch(/POLICY|_/);
    });

    it('returns null for the wallet fallback codes and unknown codes', () => {
        expect(describePolicyReason('POLICY_DENIED')).toBeNull();
        expect(describePolicyReason('UNDECODABLE')).toBeNull();
        expect(describePolicyReason('POLICY_SOMETHING_NEW')).toBeNull();
        expect(describePolicyReason('')).toBeNull();
    });

    it('returns null for non-strings and inherited property names', () => {
        expect(describePolicyReason(null)).toBeNull();
        expect(describePolicyReason(undefined)).toBeNull();
        expect(describePolicyReason(42)).toBeNull();
        expect(describePolicyReason('toString')).toBeNull();
        expect(describePolicyReason('__proto__')).toBeNull();
    });
});
