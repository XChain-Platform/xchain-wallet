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
import {
    decodeListCreateMeta,
    decodeListSetMeta,
} from '../../../packages/core/src/decoder/list_meta_description.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const chainRegistry = defaultRegistry();

describe('decodeAction LIST metadata', () => {
    it('dispatches version 4 creates to the metadata describer', () => {
        const params = {
            VERSION: '4',
            TYPE: '1',
            NAME: 'Official tokens',
            DESCRIPTION: 'Tokens issued by our team',
            MEMO: 'initial list',
            ITEM: ['JDOG', 'BRRR'],
        };

        expect(decodeAction({
            action: 'LIST',
            params,
            chainId: 'dogecoin-mainnet',
            chainRegistry,
        })).toEqual(decodeListCreateMeta(params, ' on Dogecoin'));
    });

    it('dispatches version 5 renames to the metadata describer', () => {
        const params = {
            VERSION: '5',
            LIST_ACTION_INDEX: '41',
            NAME: 'Trusted recipients',
            DESCRIPTION: '',
            MEMO: 'rename',
        };

        expect(decodeAction({ action: 'LIST', params })).toEqual(decodeListSetMeta(params));
    });

    it('keeps the version 0 create summary', () => {
        expect(decodeAction({
            action: 'LIST',
            params: { VERSION: '0', TYPE: '1', MEMO: '', ITEM: ['JDOG', 'BRRR'] },
        }).summary).toBe('Create token list of 2 items');
    });

    it('keeps the version 2 share summary', () => {
        expect(decodeAction({
            action: 'LIST',
            params: { VERSION: '2', LIST_ACTION_INDEX: '41', MEMO: '' },
        }).summary).toBe('Share list #41 on every chain');
    });
});
