// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    listActionSize,
    listActionSizeError,
    listActionString,
} from '../../../packages/core/src/shared/utils/listActionSize.js';

const LEGACY = { addressTypes: ['p2pkh'] };
const HD = { source: 'hd', publicKey: `02${'ab'.repeat(32)}` };

describe('LIST action size validation', () => {
    it('mirrors create, metadata create, and edit wire strings', () => {
        expect(listActionString({
            VERSION: '0', TYPE: '1', MEMO: 'memo', ITEM: ['ONE', 'TWO'],
        })).toBe('LIST|0|1|memo|ONE|TWO');
        expect(listActionString({
            VERSION: '4', TYPE: '2', NAME: 'People', DESCRIPTION: 'Team', ITEM: ['addr'],
        })).toBe('LIST|4|2|People|Team||addr');
        expect(listActionString({
            VERSION: '1', EDIT: '2', LIST_ACTION_INDEX: '42', ITEM: ['OLD'],
        })).toBe('LIST|1|2|42||OLD');
    });

    it('accepts the exact legacy compiled ceiling and refuses one byte more', () => {
        const base = listActionString({ VERSION: '0', TYPE: '1', ITEM: [''] });
        const atLimit = listActionSize({
            VERSION: '0', TYPE: '1', ITEM: ['A'.repeat(8189 - base.length)],
        }, LEGACY, HD);
        const overLimit = listActionSize({
            VERSION: '0', TYPE: '1', ITEM: ['A'.repeat(8190 - base.length)],
        }, LEGACY, HD);

        expect(atLimit).toMatchObject({ compiledBytes: 8192, maxBytes: 8192, oversized: false });
        expect(overLimit).toMatchObject({ compiledBytes: 8193, maxBytes: 8192, oversized: true });
        expect(listActionSizeError(overLimit)).toMatch(/8,193 bytes.*8,192-byte limit/);
    });

    it('uses the envelope ceiling only with Taproot, a local key source, and a compressed key', () => {
        const params = { VERSION: '0', TYPE: '1', ITEM: ['A'.repeat(9000)] };

        expect(listActionSize(params, { addressTypes: ['p2tr'] }, HD))
            .toMatchObject({ maxBytes: 390000, oversized: false });
        expect(listActionSize(params, { addressTypes: ['p2tr'] }, { ...HD, source: 'ledger' }))
            .toMatchObject({ maxBytes: 8192, oversized: true });
        expect(listActionSize(params, { addressTypes: ['p2tr'] }, { source: 'hd', publicKey: '02aa' }))
            .toMatchObject({ maxBytes: 8192, oversized: true });
    });
});
