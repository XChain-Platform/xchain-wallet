// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { pageGutterForWidth } from '../../e2e/layout/sweep.js';

describe('page gutter', () => {
    it.each([0, 639, 640, 899, 900, 1400])('is 8px at viewport width %i', (width) => {
        expect(pageGutterForWidth(width)).toBe(8);
    });
});
