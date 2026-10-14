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
    decodeListCreateMeta,
    decodeListSetMeta,
} from '../../../packages/core/src/decoder/list_meta_description.js';

const details = (decoded) => Object.fromEntries(
    decoded.details.map(({ label, value }) => [label, value]),
);

describe('LIST metadata edge branches', () => {
    it('accepts a scalar item as a one-item list', () => {
        const decoded = decodeListCreateMeta({ TYPE: '1', ITEM: 'JDOG' });

        expect(decoded.summary).toBe('Create token list of 1 item');
        expect(details(decoded)).toMatchObject({ Items: '1', Sample: 'JDOG' });
    });

    it('counts every item while limiting the sample to five', () => {
        const decoded = decodeListCreateMeta({
            TYPE: '2',
            ITEM: ['A', 'B', 'C', 'D', 'E', 'F'],
        });

        expect(details(decoded)).toMatchObject({
            Items: '6',
            Sample: 'A, B, C, D, E',
        });
    });

    it('keeps an unknown list type visible instead of assigning a known kind', () => {
        const decoded = decodeListCreateMeta({ TYPE: '9', ITEM: ['value'] });

        expect(decoded.summary).toBe('Create item list of 1 item');
        expect(details(decoded).Type).toBe('9');
    });

    it('reports both invalid clear sentinels on create', () => {
        const decoded = decodeListCreateMeta({
            TYPE: '1', NAME: '-', DESCRIPTION: '-', ITEM: ['JDOG'],
        });

        expect(decoded.warnings).toHaveLength(2);
        expect(decoded.warnings[0]).toMatch(/^Name cannot be cleared/);
        expect(decoded.warnings[1]).toMatch(/^Description cannot be cleared/);
    });

    it('stringifies array-shaped set fields and memo values', () => {
        const decoded = decodeListSetMeta({
            LIST_ACTION_INDEX: ['41'],
            NAME: ['Team', 'wallets'],
            DESCRIPTION: null,
            MEMO: ['first', 'second'],
        });

        expect(decoded.summary).toBe('Update metadata on list #41');
        expect(details(decoded)).toMatchObject({
            Name: 'Set to: Team, wallets',
            Description: 'Unchanged',
            Memo: 'first, second',
        });
    });
});
