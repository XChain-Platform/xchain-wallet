// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: an allowed-output max value is stored as a JavaScript number, so
// a value past 2^53 would be stored as a different number than the one typed.
// The editor refuses it instead of rounding.

import { describe, it, expect } from 'vitest';
import { buildPolicyDraft, emptyPolicyDraft } from '../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';

const draftWith = (maxValue) => ({
    ...emptyPolicyDraft(),
    allowedActionsText: 'SEND',
    allowedOutputs: [{ address: 'bcrt1qexample', maxValue }],
});

describe('allowed-output max value', () => {
    it.each(['9007199254740993', '99999999999999999999'])('refuses %s', (maxValue) => {
        expect(buildPolicyDraft(draftWith(maxValue)).error).toMatch(/whole number no greater than/);
    });

    it('keeps an exact value', () => {
        expect(buildPolicyDraft(draftWith('9007199254740991')).allowedOutputs[0].maxValue).toBe(9007199254740991);
    });
});
