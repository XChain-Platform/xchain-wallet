// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { layoutSweepFailures } from '../../e2e/layout/sweep.js';

describe('layout sweep gutter checks', () => {
    it('holds the header right edge to the ruled gutter', () => {
        const layout = (headerRightGap) => ({
            contentLeft: 8,
            contentRightGap: 8,
            headerLeft: 8,
            headerRightGap,
            first: { kind: 'list', left: 8, rightGap: 8, topGap: 16 },
        });

        expect(layoutSweepFailures([
            { label: 'aligned', vw: 820, layout: layout(8) },
        ])).toEqual([]);
        expect(layoutSweepFailures([
            { label: 'over scrollbar', vw: 820, layout: layout(6) },
        ])).toEqual([
            'over scrollbar: header right gap 6px, expected 8px',
        ]);
    });
});
