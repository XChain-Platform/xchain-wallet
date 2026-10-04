// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { fundingEncoderOpts } from '../../../packages/core/src/util/funding_encoder_opts.js';

describe('fundingEncoderOpts', () => {
    it('maps the source address to the exact encoder options without mutating the source', () => {
        const source = { address: 'bc1qfundingaddress', label: 'primary' };
        const original = { ...source };

        const result = fundingEncoderOpts(source);

        expect(result).toStrictEqual({
            sourceAddress: source.address,
            change: source.address,
        });
        expect(result.sourceAddress).toBe(result.change);
        expect(Object.keys(result)).toStrictEqual(['sourceAddress', 'change']);
        expect(source).toStrictEqual(original);
    });
});
