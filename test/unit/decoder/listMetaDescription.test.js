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

function detailMap(decoded) {
    return Object.fromEntries(decoded.details.map(({ label, value }) => [label, value]));
}

describe('LIST create metadata description', () => {
    it('describes a named token list', () => {
        const decoded = decodeListCreateMeta({
            TYPE: '1',
            NAME: 'Official tokens',
            DESCRIPTION: 'Tokens issued by our team',
            MEMO: 'initial list',
            ITEM: ['JDOG', 'BRRR'],
        }, ' on Dogecoin');

        expect(decoded).toEqual({
            summary: 'Create token list "Official tokens" of 2 items on Dogecoin',
            details: [
                { label: 'Type', value: 'Token' },
                { label: 'Name', value: 'Official tokens' },
                { label: 'Description', value: 'Tokens issued by our team' },
                { label: 'Items', value: '2' },
                { label: 'Sample', value: 'JDOG, BRRR' },
                { label: 'Memo', value: 'initial list' },
            ],
            warnings: [],
        });
    });

    it('describes an address list with only a description', () => {
        const decoded = decodeListCreateMeta({
            TYPE: '2',
            NAME: '',
            DESCRIPTION: 'Treasury recipients',
            MEMO: '',
            ITEM: ['DOne', 'DTwo'],
        });

        expect(decoded.summary).toBe('Create address list of 2 items');
        expect(detailMap(decoded)).toEqual({
            Type: 'Address',
            Description: 'Treasury recipients',
            Items: '2',
            Sample: 'DOne, DTwo',
        });
        expect(decoded.warnings).toEqual([]);
    });

    it('describes a union list', () => {
        const decoded = decodeListCreateMeta({
            TYPE: '3',
            NAME: 'Combined policy',
            DESCRIPTION: '',
            MEMO: 'combined',
            ITEM: ['41', '52', '63'],
        });

        expect(decoded.summary).toBe('Create union list "Combined policy" of 3 member lists');
        expect(detailMap(decoded)).toEqual({
            Type: 'Union',
            Name: 'Combined policy',
            Items: '3',
            'Member list indexes': '41, 52, 63',
            Memo: 'combined',
        });
        expect(decoded.warnings).toEqual([]);
    });

    it('matches format 0 wording when neither metadata field is set', () => {
        expect(decodeListCreateMeta({
            TYPE: '1',
            NAME: '',
            DESCRIPTION: '',
            MEMO: '',
            ITEM: ['JDOG'],
        })).toEqual({
            summary: 'Create token list of 1 item',
            details: [
                { label: 'Type', value: 'Token' },
                { label: 'Items', value: '1' },
                { label: 'Sample', value: 'JDOG' },
            ],
            warnings: [],
        });
    });

    it('warns when the list has no items', () => {
        const decoded = decodeListCreateMeta({
            TYPE: '2',
            NAME: 'Empty list',
            DESCRIPTION: '',
            MEMO: '',
            ITEM: [],
        });

        expect(decoded.summary).toBe('Create address list "Empty list" of ? items');
        expect(detailMap(decoded).Items).toBe('0');
        expect(decoded.warnings).toEqual(['List has no items.']);
    });

    it('warns when a create uses a clear sentinel', () => {
        const name = decodeListCreateMeta({
            TYPE: '1', NAME: '-', DESCRIPTION: '', MEMO: '', ITEM: ['JDOG'],
        });
        const description = decodeListCreateMeta({
            TYPE: '2', NAME: '', DESCRIPTION: '-', MEMO: '', ITEM: ['DOne'],
        });

        expect(name.warnings).toEqual([
            'Name cannot be cleared when creating a list. The indexer will refuse it as NAME (format).',
        ]);
        expect(description.warnings).toEqual([
            'Description cannot be cleared when creating a list. The indexer will refuse it as DESCRIPTION (format).',
        ]);
    });
});

describe('LIST set metadata description', () => {
    it('describes setting each field', () => {
        const decoded = decodeListSetMeta({
            LIST_ACTION_INDEX: '41',
            NAME: 'Team wallets',
            DESCRIPTION: 'Current treasury signers',
            MEMO: 'Quarterly update',
        });

        expect(decoded.summary).toBe('Update metadata on list #41');
        expect(detailMap(decoded)).toEqual({
            'List action index': '41',
            Name: 'Set to: Team wallets',
            Description: 'Set to: Current treasury signers',
            Memo: 'Quarterly update',
        });
        expect(decoded.warnings).toEqual([
            'Updating a shared list name or description charges the shared-list edit fee.',
        ]);
    });

    it('describes an unchanged name and a cleared description', () => {
        const decoded = decodeListSetMeta({
            LIST_ACTION_INDEX: '41', NAME: '', DESCRIPTION: '-', MEMO: '',
        });

        expect(detailMap(decoded)).toMatchObject({ Name: 'Unchanged', Description: 'Cleared' });
    });

    it('describes a cleared name and an unchanged description', () => {
        const decoded = decodeListSetMeta({
            LIST_ACTION_INDEX: '41', NAME: '-', DESCRIPTION: '', MEMO: '',
        });

        expect(detailMap(decoded)).toMatchObject({ Name: 'Cleared', Description: 'Unchanged' });
    });

    it('warns when both fields are unchanged', () => {
        const decoded = decodeListSetMeta({
            LIST_ACTION_INDEX: '41', NAME: '', DESCRIPTION: '', MEMO: '',
        });

        expect(decoded.warnings).toEqual([
            'Updating a shared list name or description charges the shared-list edit fee.',
            'Name and description are both unchanged. The indexer will refuse this action as NAME (no change).',
        ]);
    });

    it('warns and uses a question mark when the index is empty', () => {
        const decoded = decodeListSetMeta({
            LIST_ACTION_INDEX: '', NAME: 'Team wallets', DESCRIPTION: '', MEMO: '',
        });

        expect(decoded.summary).toBe('Update metadata on list #?');
        expect(decoded.warnings).toContain('List action index is empty.');
    });

    it('neutralizes bidi controls in every rendered metadata value', () => {
        const create = decodeListCreateMeta({
            TYPE: '1',
            NAME: 'Team\u202Ewallets',
            DESCRIPTION: 'Current\u202Esigners',
            MEMO: '',
            ITEM: ['JDOG'],
        });
        const set = decodeListSetMeta({
            LIST_ACTION_INDEX: '41',
            NAME: 'Team\u202Ewallets',
            DESCRIPTION: 'Current\u202Esigners',
            MEMO: '',
        });

        expect(create.summary).toContain('"Team␦wallets"');
        expect(detailMap(create)).toMatchObject({
            Name: 'Team␦wallets',
            Description: 'Current␦signers',
        });
        expect(detailMap(set)).toMatchObject({
            Name: 'Set to: Team␦wallets',
            Description: 'Set to: Current␦signers',
        });
    });
});
