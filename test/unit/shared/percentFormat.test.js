// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { percentChangeDisplay } from '../../../packages/core/src/shared/utils/percentFormat.js';

describe('percentChangeDisplay', () => {
    it('uses explicit signs, fixed precision, and textual direction', () => {
        expect(percentChangeDisplay(1.234)).toEqual({
            text: '+1.23%', direction: 'positive', label: 'Increase: +1.23%',
        });
        expect(percentChangeDisplay(-1.234)).toEqual({
            text: '-1.23%', direction: 'negative', label: 'Decrease: -1.23%',
        });
    });

    it('renders exact and rounded zero without a directional sign', () => {
        expect(percentChangeDisplay(0)).toEqual({
            text: '0.00%', direction: 'neutral', label: 'No change: 0.00%',
        });
        expect(percentChangeDisplay(-0.004)).toEqual({
            text: '0.00%', direction: 'neutral', label: 'No change: 0.00%',
        });
    });

    it('rejects values that cannot be displayed as percentages', () => {
        expect(percentChangeDisplay(Number.NaN)).toBeNull();
        expect(percentChangeDisplay(Number.POSITIVE_INFINITY)).toBeNull();
        expect(percentChangeDisplay(/** @type {any} */ ('1.25'))).toBeNull();
    });
});
