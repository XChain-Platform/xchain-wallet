// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One LIST as both the allow-list and the block-list admits nobody. These pin
// the rule the dispenser edit form refuses on, including the case where one
// slot is typed and the other is already bound on chain.

import { describe, it, expect } from 'vitest';
import {
    listInBothSlots,
    editListConflict,
    listInBothSlotsMessage,
} from '../../../packages/core/src/flows/accessListSlots.js';

describe('listInBothSlots', () => {
    it('flags the same list in both slots', () => {
        expect(listInBothSlots({ allowList: '2701', blockList: '2701' })).toBe(true);
    });

    it('treats leading zeros and padding as the same list', () => {
        expect(listInBothSlots({ allowList: ' 02701', blockList: '2701 ' })).toBe(true);
    });

    it('passes two different lists, or a blank slot', () => {
        expect(listInBothSlots({ allowList: '2701', blockList: '2702' })).toBe(false);
        expect(listInBothSlots({ allowList: '', blockList: '' })).toBe(false);
        expect(listInBothSlots({ allowList: null, blockList: undefined })).toBe(false);
        expect(listInBothSlots({ allowList: '2701', blockList: '' })).toBe(false);
    });
});

describe('editListConflict', () => {
    it('refuses an allow-list edit that matches the list already bound as the block-list', () => {
        expect(editListConflict({ allowList: '2701', blockList: '', currentBlockList: '2701' })).toMatch(/#2701/);
    });

    it('refuses the same list typed into both slots', () => {
        expect(editListConflict({ allowList: '5', blockList: '5' })).toBe(listInBothSlotsMessage('5'));
    });

    it('stays silent for an edit that touches no list', () => {
        const bound = { currentAllowList: '7', currentBlockList: 7 };
        expect(editListConflict({ allowList: '', blockList: '', ...bound })).toBeNull();
    });

    it('passes an edit that replaces the clashing half', () => {
        const bound = { currentAllowList: '7', currentBlockList: 7 };
        expect(editListConflict({ allowList: '8', blockList: '', ...bound })).toBeNull();
    });
});
