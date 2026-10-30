// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: "00" is a run of digits that is not the string "0", so a bare
// string comparison let guard contract zero through the positive-number check.
// Any all-zero guard id is refused; digits with a nonzero value stay as typed.

import { describe, it, expect } from 'vitest';
import { controllerBindValidationError } from '../../packages/core/src/flows/controllerBind.js';

const base = { target: 'address', unbind: false, actionClass: 'all' };

describe('controller bind guard contract zero', () => {
    it.each(['0', '00', '000'])('refuses guard contract %s', (controller) => {
        expect(controllerBindValidationError({ ...base, controller })).toMatch(/positive whole action number/);
    });

    it('accepts a nonzero guard contract', () => {
        expect(controllerBindValidationError({ ...base, controller: '007' })).toBeNull();
        expect(controllerBindValidationError({ ...base, controller: '18446744073709551615' })).toBeNull();
    });
});
