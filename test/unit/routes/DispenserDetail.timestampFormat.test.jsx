// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    formatLocalClock,
    formatUnixDate,
} from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

afterEach(() => vi.restoreAllMocks());

describe('DispenserDetail timestamp fallbacks', () => {
    it('uses a readable UTC date when locale date formatting is unavailable', () => {
        vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });

        const text = formatUnixDate(1790455620);

        expect(text).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/);
        expect(text).toContain('GMT');
        expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('uses a labelled UTC clock when locale time formatting is unavailable', () => {
        vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });

        expect(formatLocalClock(1790455620000)).toMatch(/^\d{2}:\d{2} UTC$/);
    });
});
