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
        const base = listActionString({ VERSION: '0', TYPE: '1', ITEM: ['A'] });
        const atLimit = listActionSize({
            VERSION: '0', TYPE: '1', ITEM: ['A'.repeat(8190 - base.length)],
        });
        const overLimit = listActionSize({
            VERSION: '0', TYPE: '1', ITEM: ['A'.repeat(8191 - base.length)],
        });

        expect(atLimit).toMatchObject({ compiledBytes: 8192, maxBytes: 8192, oversized: false });
        expect(overLimit).toMatchObject({ compiledBytes: 8193, maxBytes: 8192, oversized: true });
        expect(listActionSizeError(overLimit)).toMatch(/8,193 bytes.*8,192 bytes one action can hold, and not even one token fits/);
    });

    it('keeps the 8192 ceiling where a Taproot envelope is available', () => {
        // Above 8192 the encoder would use an envelope on a Taproot chain with a
        // local key, but the reveal's repeating ITEM field cannot be verified,
        // so the Lists screen refuses at 8192 on every chain and signer.
        const params = { VERSION: '0', TYPE: '1', ITEM: ['A'.repeat(9000)] };
        expect(listActionSize(params)).toMatchObject({ maxBytes: 8192, oversized: true });
    });

    it('names how many addresses fit and how many were given', () => {
        const items = Array.from({ length: 300 }, (_, i) => String(i).padStart(44, 'x'));
        const size = listActionSize({ VERSION: '0', TYPE: '2', ITEM: items });
        expect(listActionSizeError(size)).toBe(
            'This list has 300 addresses (13,512 bytes), but one action holds 8,192 bytes, '
            + 'which fits 181 of them. Remove 119 addresses.',
        );
    });

    it('sizes an edit and a list with metadata by the same ceiling', () => {
        const items = Array.from({ length: 300 }, (_, i) => String(i).padStart(44, 'x'));
        expect(listActionSizeError(listActionSize({ VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '7', ITEM: items })))
            .toMatch(/^This change has 300 items .* which fits 18\d of them\. Remove \d+ items\.$/);
        expect(listActionSizeError(listActionSize({
            VERSION: '4', TYPE: '1', NAME: 'N', DESCRIPTION: 'D', ITEM: items,
        }))).toMatch(/^This list has 300 tokens /);
    });

    it('says nothing for a list that fits', () => {
        expect(listActionSizeError(listActionSize({ VERSION: '0', TYPE: '2', ITEM: ['a', 'b'] }))).toBeNull();
    });
});
