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
    decodeListShare,
    decodeListTransfer,
    decodeUnionListCreate,
} from '../../../packages/core/src/decoder/list_share_description.js';

describe('LIST share and transfer edge branches', () => {
    it('omits the member-index detail for a union larger than five', () => {
        const decoded = decodeUnionListCreate(['1', '2', '3', '4', '5', '6'], '', '');

        expect(decoded.summary).toBe('Create union list of 6 member lists');
        expect(decoded.details).toEqual([
            { label: 'Type', value: 'Union' },
            { label: 'Items', value: '6' },
        ]);
    });

    it('omits an empty share memo row', () => {
        const decoded = decodeListShare({ LIST_ACTION_INDEX: '41', MEMO: '' });

        expect(decoded.details).toEqual([{ label: 'List action index', value: '41' }]);
    });

    it.each(['^abc', '^12suffix', ' ^12'])('preserves non-matching destination %j', (destination) => {
        const decoded = decodeListTransfer({
            LIST_ACTION_INDEX: '41', DESTINATION: destination,
        });

        expect(decoded.details[1].value).toBe(destination);
    });

    it('stringifies array fields recursively', () => {
        const decoded = decodeListTransfer({
            LIST_ACTION_INDEX: ['41', '52'],
            DESTINATION: ['addr1', ['addr2', 'addr3']],
            MEMO: ['first', 'second'],
        });

        expect(decoded.summary).toBe('Transfer list #41, 52 to addr1, addr2, addr3');
        expect(decoded.details).toContainEqual({ label: 'Memo', value: 'first, second' });
    });

    it('reports both required transfer fields when both are empty', () => {
        expect(decodeListTransfer({}).warnings).toEqual([
            'This transfer cannot be undone.',
            'The new owner alone can edit, share or transfer the list.',
            'List action index is empty.',
            'Destination is empty.',
        ]);
    });
});
