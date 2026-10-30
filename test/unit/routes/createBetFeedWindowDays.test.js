// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The custom publish window is typed in days. Number() reads "0x10" as 16 and
// "1e1" as 10, so a window could be set that is not the text typed.

import { describe, expect, it } from 'vitest';
import { customWindowSeconds } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';

describe('customWindowSeconds', () => {
    it.each([
        ['14', 14 * 86400],
        [' 0.5 ', 43200],
        ['.5', 43200],
        ['0.05', 4320],
    ])('reads %j', (typed, seconds) => {
        expect(customWindowSeconds(typed)).toBe(seconds);
    });

    it.each(['0x10', '1e1', '5.', '-0', '-1', '0', '', 'Infinity', '５', '5,5'])('refuses %j', (typed) => {
        expect(customWindowSeconds(typed)).toBeNull();
    });
});
