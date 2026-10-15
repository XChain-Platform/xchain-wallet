// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decodeListCreateMeta } from '../../../packages/core/src/decoder/list_meta_description.js';

describe('LIST metadata low-coverage branches', () => {
    it('describes a union whose item field is null', () => {
        const decoded = decodeListCreateMeta({ TYPE: '3', ITEM: null });

        expect(decoded.summary).toBe('Create union list of ? member lists');
        expect(decoded.details).toEqual([
            { label: 'Type', value: 'Union' },
            { label: 'Items', value: '0' },
        ]);
        expect(decoded.warnings).toEqual(['List has no items.']);
    });

    it('warns when both the type and item field are absent', () => {
        const decoded = decodeListCreateMeta({});

        expect(decoded.summary).toBe('Create item list of ? items');
        expect(decoded.warnings).toEqual([
            'List type is empty. Specify a token list or an address list.',
            'List has no items.',
        ]);
    });
});
