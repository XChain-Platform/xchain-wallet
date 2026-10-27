// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The policy editor stores a window length, an action count and an
// allowed-output cap as JavaScript numbers. Number() reads "0x10" as 16 and
// "1e3" as 1000, so a limit could be stored that is not the text typed.

import { describe, it, expect } from 'vitest';
import { buildPolicyDraft, emptyPolicyDraft } from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';

const base = () => ({ ...emptyPolicyDraft(), allowedActionsText: 'SEND' });

const withOutput = (maxValue) => ({
    ...base(),
    allowedOutputs: [{ address: 'bcrt1qexample', maxValue }],
});

const withWindow = (windowHours, windowMaxActions = '3') => ({
    ...base(),
    windowEnabled: true,
    windowHours,
    windowMaxActions,
});

const BAD = ['0x10', '1e3', '5.', '.5', '-0', '-5', 'Infinity', '５', '5,5', '1_000', '0b11'];

describe('allowed-output max value text', () => {
    it.each(BAD)('refuses %j', (typed) => {
        expect(buildPolicyDraft(withOutput(typed)).error).toMatch(/Allowed-output max value/);
    });

    it('keeps digits, trimmed', () => {
        expect(buildPolicyDraft(withOutput(' 1000 ')).allowedOutputs[0].maxValue).toBe(1000);
        expect(buildPolicyDraft(withOutput('0')).allowedOutputs[0].maxValue).toBe(0);
    });
});

describe('rolling window length text', () => {
    it.each(['0x10', '1e1', '-0', 'Infinity', '５', '5,5', '5.'])('refuses %j', (typed) => {
        expect(buildPolicyDraft(withWindow(typed)).error).toMatch(/window length in hours/);
    });

    it('keeps plain decimals', () => {
        expect(buildPolicyDraft(withWindow('24')).policy.maxPerWindow.hours).toBe(24);
        expect(buildPolicyDraft(withWindow(' 0.5 ')).policy.maxPerWindow.hours).toBe(0.5);
    });
});

describe('rolling window action count text', () => {
    it.each(['0x10', '1e2', '5.0', '5.', '-0', 'Infinity', '５'])('refuses %j', (typed) => {
        expect(buildPolicyDraft(withWindow('24', typed)).error).toMatch(/Max actions per window/);
    });

    it('keeps digits', () => {
        expect(buildPolicyDraft(withWindow('24', '12')).policy.maxPerWindow.maxActions).toBe(12);
    });
});
