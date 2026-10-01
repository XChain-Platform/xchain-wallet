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
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const chainRegistry = defaultRegistry();

describe('decodeAction LIST share', () => {
    it('describes permanent cross-chain sharing and its fee', () => {
        const decoded = decodeAction({
            action: 'LIST',
            params: { VERSION: '2', LIST_ACTION_INDEX: '41', MEMO: 'trusted recipients' },
        });

        expect(decoded).toEqual({
            summary: 'Share list #41 on every chain',
            details: [
                { label: 'List action index', value: '41' },
                { label: 'Memo', value: 'trusted recipients' },
            ],
            warnings: [
                'Sharing is permanent. There is no unshare.',
                'Sharing charges the LIST_SHARE fee.',
            ],
        });
    });

    it('warns when the list action index is empty', () => {
        const decoded = decodeAction({
            action: 'LIST',
            params: { VERSION: '2', LIST_ACTION_INDEX: '', MEMO: 'memo' },
        });

        expect(decoded).toEqual({
            summary: 'Share list #? on every chain',
            details: [
                { label: 'List action index', value: '' },
                { label: 'Memo', value: 'memo' },
            ],
            warnings: [
                'Sharing is permanent. There is no unshare.',
                'Sharing charges the LIST_SHARE fee.',
                'List action index is empty.',
            ],
        });
    });
});

describe('decodeAction LIST transfer', () => {
    it('describes a short destination as an address id', () => {
        const decoded = decodeAction({
            action: 'LIST',
            params: { VERSION: '3', LIST_ACTION_INDEX: '41', DESTINATION: '^902', MEMO: 'handoff' },
        });

        expect(decoded).toEqual({
            summary: 'Transfer list #41 to address id 902',
            details: [
                { label: 'List action index', value: '41' },
                { label: 'Destination', value: 'address id 902' },
                { label: 'Memo', value: 'handoff' },
            ],
            warnings: [
                'This transfer cannot be undone.',
                'The new owner alone can edit, share or transfer the list.',
            ],
        });
    });

    it('warns when the list action index and destination are empty', () => {
        const decoded = decodeAction({
            action: 'LIST',
            params: { VERSION: '3', LIST_ACTION_INDEX: '', DESTINATION: '', MEMO: 'memo' },
        });

        expect(decoded).toEqual({
            summary: 'Transfer list #? to ?',
            details: [
                { label: 'List action index', value: '' },
                { label: 'Destination', value: '' },
                { label: 'Memo', value: 'memo' },
            ],
            warnings: [
                'This transfer cannot be undone.',
                'The new owner alone can edit, share or transfer the list.',
                'List action index is empty.',
                'Destination is empty.',
            ],
        });
    });
});

describe('decodeAction LIST union create', () => {
    it('describes member list indexes and appends the chain suffix', () => {
        const decoded = decodeAction({
            action: 'LIST',
            params: { VERSION: '0', TYPE: '3', MEMO: 'combined policy', ITEM: ['41', '52'] },
            chainId: 'dogecoin-mainnet',
            chainRegistry,
        });

        expect(decoded).toEqual({
            summary: 'Create union list of 2 member lists on Dogecoin',
            details: [
                { label: 'Type', value: 'Union' },
                { label: 'Items', value: '2' },
                { label: 'Member list indexes', value: '41, 52' },
                { label: 'Memo', value: 'combined policy' },
            ],
            warnings: [],
        });
    });

    it('uses an unknown count and warns when the union has no members', () => {
        const decoded = decodeAction({
            action: 'LIST',
            params: { VERSION: '0', TYPE: '3', MEMO: '' },
        });

        expect(decoded).toEqual({
            summary: 'Create union list of ? member lists',
            details: [
                { label: 'Type', value: 'Union' },
                { label: 'Items', value: '0' },
            ],
            warnings: ['List has no items.'],
        });
    });
});
