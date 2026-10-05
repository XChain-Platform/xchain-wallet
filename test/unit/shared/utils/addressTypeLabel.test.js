// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    ADDRESS_TYPE_LABEL,
    addressTypeLabel,
} from '../../../../packages/core/src/shared/utils/addressTypeLabel.js';

const EXPECTED_LABELS = {
    p2pkh: 'Classic',
    'p2sh-p2wpkh': 'SegWit (compatible)',
    p2wpkh: 'SegWit',
    p2tr: 'Taproot',
};

describe('ADDRESS_TYPE_LABEL', () => {
    it('is frozen and maps each supported address type', () => {
        expect(Object.isFrozen(ADDRESS_TYPE_LABEL)).toBe(true);
        expect(ADDRESS_TYPE_LABEL).toEqual(EXPECTED_LABELS);
    });
});

describe('addressTypeLabel', () => {
    it.each(Object.entries(EXPECTED_LABELS))('returns %s as %s', (type, label) => {
        expect(addressTypeLabel(type)).toBe(label);
    });

    it.each([
        ['unknown type', 'P2WSH', 'P2WSH'],
        ['a number', 42, '42'],
        ['undefined', undefined, 'UNDEFINED'],
    ])('falls back for %s', (_case, input, expected) => {
        expect(addressTypeLabel(input)).toBe(expected);
    });
});
