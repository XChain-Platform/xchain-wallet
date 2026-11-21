// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    HOME_DETAIL_MIN_PX,
    HOME_LIST_MIN_PX,
} from '../../../packages/core/src/shared/components/HomeWideLayout.jsx';
import { homeFoldSplit } from '../../../packages/core/src/shared/utils/homeFoldSplit.js';

const floors = {
    minList: HOME_LIST_MIN_PX,
    minDetail: HOME_DETAIL_MIN_PX,
};

describe('homeFoldSplit', () => {
    it('rounds the list side and assigns the rest to detail', () => {
        expect(homeFoldSplit(
            { vertical: true, dividerX: 475.5 },
            { left: 0, width: 951 },
            floors,
        )).toEqual({ listWidth: 476, detailWidth: 475, fitsMinimums: true });
    });

    it('measures a viewport fold from the container edge beside a rail', () => {
        expect(homeFoldSplit(
            { vertical: true, dividerX: 475.5 },
            { left: 72, width: 951 },
            floors,
        )).toEqual({ listWidth: 404, detailWidth: 547, fitsMinimums: false });
    });

    it.each([
        ['a horizontal fold', { vertical: false, dividerX: 475.5 }, { left: 0, width: 951 }],
        ['a null divider', { vertical: true, dividerX: null }, { left: 0, width: 951 }],
        ['the container left edge', { vertical: true, dividerX: 72 }, { left: 72, width: 951 }],
        ['past the container right edge', { vertical: true, dividerX: 1024 }, { left: 72, width: 951 }],
        ['a zero-width container', { vertical: true, dividerX: 72.5 }, { left: 72, width: 0 }],
    ])('rejects %s', (_label, fold, container) => {
        expect(homeFoldSplit(fold, container, floors)).toBeNull();
    });
});
