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
    listEditValue,
    withListRemovalDescriptions,
} from '../../../packages/core/src/decoder/list_removal_description.js';

describe('list removal edge branches', () => {
    it('reads version from params and appends both missing removal rows', () => {
        const decoded = { summary: 'Edit order', details: null, warnings: [] };
        const result = withListRemovalDescriptions(decoded, {
            action: 'order',
            params: { VERSION: 2, ALLOW_LIST: '0', BLOCK_LIST: '000' },
        });

        expect(result).toEqual({
            summary: 'Edit order',
            details: [
                { label: 'Allow list', value: 'Remove allow list' },
                { label: 'Block list', value: 'Remove block list' },
            ],
            warnings: [],
        });
    });

    it('returns the original decode when neither list value is a zero sentinel', () => {
        const decoded = { summary: 'Edit swap', details: [], warnings: [] };

        expect(withListRemovalDescriptions(decoded, {
            action: 'SWAP',
            version: 2,
            params: { ALLOW_LIST: '', BLOCK_LIST: '17' },
        })).toBe(decoded);
    });

    it('preserves extra row properties when replacing a removal value', () => {
        const result = withListRemovalDescriptions({
            summary: 'Edit dispenser',
            details: [{ label: 'Allow list', value: '0', source: 'sdk' }],
            warnings: [],
        }, {
            action: 'DISPENSER',
            version: '2',
            params: { ALLOW_LIST: 0 },
        });

        expect(result.details[0]).toEqual({
            label: 'Allow list', value: 'Remove allow list', source: 'sdk',
        });
    });

    it('leaves undefined parse data and blank edit values unchanged', () => {
        const decoded = { summary: 'No edit', details: [], warnings: [] };

        expect(withListRemovalDescriptions(decoded, undefined)).toBe(decoded);
        expect(listEditValue('', 'allow')).toBe('');
    });
});
