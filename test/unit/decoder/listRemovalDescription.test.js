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

const decodedDescription = () => ({
    summary: 'Edit dispenser',
    details: [{ label: 'Asset', value: 'JDOG' }],
    warnings: [],
});

describe('listEditValue', () => {
    it.each([
        [0, 'allow', 'Remove allow list'],
        ['000', 'block', 'Remove block list'],
        [' \t000\n', 'allow', 'Remove allow list'],
    ])('describes the all-zero value %j as a removal', (value, kind, expected) => {
        expect(listEditValue(value, kind)).toBe(expected);
    });

    it('leaves a non-zero value unchanged', () => {
        expect(listEditValue('001', 'allow')).toBe('001');
    });
});

describe('withListRemovalDescriptions removal rows', () => {
    it.each([
        ['ALLOW_LIST', 'Allow list', 'Remove allow list', 0],
        ['ALLOW_LIST', 'Allow list', 'Remove allow list', '000'],
        ['ALLOW_LIST', 'Allow list', 'Remove allow list', ' \t000\n'],
        ['BLOCK_LIST', 'Block list', 'Remove block list', 0],
        ['BLOCK_LIST', 'Block list', 'Remove block list', '000'],
        ['BLOCK_LIST', 'Block list', 'Remove block list', ' \t000\n'],
    ])('describes a zero %s row in a version-2 edit', (field, label, expected, value) => {
        const decoded = decodedDescription();
        decoded.details.push({ label, value: '0' });

        const result = withListRemovalDescriptions(decoded, {
            action: 'DISPENSER',
            version: 2,
            params: { [field]: value },
        });

        expect(result.details.at(-1)).toEqual({ label, value: expected });
    });
});

describe('withListRemovalDescriptions preservation', () => {
    it.each([
        ['a non-edit action', { action: 'TRANSFER', version: 2, params: { ALLOW_LIST: '0' } }],
        ['a version other than 2', { action: 'DISPENSER', version: 1, params: { ALLOW_LIST: '0' } }],
    ])('returns the input unchanged for %s', (_description, parsed) => {
        const decoded = decodedDescription();

        expect(withListRemovalDescriptions(decoded, parsed)).toBe(decoded);
    });

    it('returns a null decode unchanged', () => {
        expect(withListRemovalDescriptions(null, {
            action: 'DISPENSER', version: 2, params: { ALLOW_LIST: '0' },
        })).toBeNull();
    });

    it('appends a removal description when the decoded row is missing', () => {
        const result = withListRemovalDescriptions(decodedDescription(), {
            action: 'ORDER', version: 2, params: { BLOCK_LIST: '0' },
        });

        expect(result.details).toEqual([
            { label: 'Asset', value: 'JDOG' },
            { label: 'Block list', value: 'Remove block list' },
        ]);
    });

    it('leaves other decoded rows untouched', () => {
        const untouched = { label: 'Asset', value: 'JDOG', note: 'issuer' };
        const decoded = {
            ...decodedDescription(),
            details: [{ label: 'Allow list', value: '0' }, untouched],
        };

        const result = withListRemovalDescriptions(decoded, {
            action: 'SWAP', version: 2, params: { ALLOW_LIST: '0' },
        });

        expect(result.details[1]).toBe(untouched);
        expect(result.details[1]).toEqual({ label: 'Asset', value: 'JDOG', note: 'issuer' });
    });
});
