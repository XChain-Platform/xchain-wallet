// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every native amount the tracker, encoder and wallet compose paths carry is
// at 10^8 scale, so a descriptor may not declare any other native precision.

import { describe, it, expect } from 'vitest';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const base = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');

describe('validateChainDescriptor: nativeDecimals', () => {
    it('accepts a descriptor that omits nativeDecimals', () => {
        expect(validateChainDescriptor(base).ok).toBe(true);
    });

    it('accepts nativeDecimals 8', () => {
        expect(validateChainDescriptor({ ...base, nativeDecimals: 8 }).ok).toBe(true);
    });

    it.each([0, 2, 6, 18, '8', 8.5, null, -1])('rejects nativeDecimals %j', (value) => {
        const res = validateChainDescriptor({ ...base, nativeDecimals: value });
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/nativeDecimals/);
    });
});
