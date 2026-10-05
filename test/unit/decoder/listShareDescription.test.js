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

describe('union LIST creation description', () => {
    it('describes a union of member lists', () => {
        expect(decodeUnionListCreate(['41', '52', '63'], 'Combined policy', ' on Dogecoin')).toEqual({
            summary: 'Create union list of 3 member lists on Dogecoin',
            details: [
                { label: 'Type', value: 'Union' },
                { label: 'Items', value: '3' },
                { label: 'Member list indexes', value: '41, 52, 63' },
                { label: 'Memo', value: 'Combined policy' },
            ],
            warnings: [],
        });
    });

    it('warns when the member list input is empty', () => {
        expect(decodeUnionListCreate([], '', '')).toEqual({
            summary: 'Create union list of ? member lists',
            details: [
                { label: 'Type', value: 'Union' },
                { label: 'Items', value: '0' },
            ],
            warnings: ['List has no items.'],
        });
    });
});

describe('LIST share description', () => {
    it('describes sharing a list on every chain', () => {
        expect(decodeListShare({
            LIST_ACTION_INDEX: '41',
            MEMO: 'Publish treasury signers',
        })).toEqual({
            summary: 'Share list #41 on every chain',
            details: [
                { label: 'List action index', value: '41' },
                { label: 'Memo', value: 'Publish treasury signers' },
            ],
            warnings: [
                'Sharing is permanent. There is no unshare.',
                'Sharing charges the LIST_SHARE fee.',
            ],
        });
    });

    it('warns when the list action index is missing', () => {
        expect(decodeListShare({ MEMO: 'Publish treasury signers' })).toEqual({
            summary: 'Share list #? on every chain',
            details: [
                { label: 'List action index', value: '' },
                { label: 'Memo', value: 'Publish treasury signers' },
            ],
            warnings: [
                'Sharing is permanent. There is no unshare.',
                'Sharing charges the LIST_SHARE fee.',
                'List action index is empty.',
            ],
        });
    });
});

describe('LIST transfer description', () => {
    it('describes transferring a list to an address id', () => {
        expect(decodeListTransfer({
            LIST_ACTION_INDEX: '41',
            DESTINATION: '^789',
            MEMO: 'Move to operations wallet',
        })).toEqual({
            summary: 'Transfer list #41 to address id 789',
            details: [
                { label: 'List action index', value: '41' },
                { label: 'Destination', value: 'address id 789' },
                { label: 'Memo', value: 'Move to operations wallet' },
            ],
            warnings: [
                'This transfer cannot be undone.',
                'The new owner alone can edit, share or transfer the list.',
            ],
        });
    });

    it('warns when the destination is missing', () => {
        expect(decodeListTransfer({ LIST_ACTION_INDEX: '41' })).toEqual({
            summary: 'Transfer list #41 to ?',
            details: [
                { label: 'List action index', value: '41' },
                { label: 'Destination', value: '' },
            ],
            warnings: [
                'This transfer cannot be undone.',
                'The new owner alone can edit, share or transfer the list.',
                'Destination is empty.',
            ],
        });
    });
});
