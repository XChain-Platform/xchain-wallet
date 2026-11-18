// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A split body never scrolls, so it must not reserve a scrollbar lane that the
// detail panel then overflows by (My Tokens measured 1092px in 1086px at 1280).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/components/PanelSplit.module.css', 'utf8');

describe('split body scrollbar lane', () => {
    it('drops the body lane, its end padding and the detail panel end margin together', () => {
        expect(css).toMatch(/\.twoPanelBody\.twoPanelBody,\s*\.splitBody\.splitBody\s*\{[^}]*scrollbar-gutter: auto;[^}]*padding-inline-end: 0;/);
        expect(css).toMatch(/\.twoPanelBody\.twoPanelBody \.detailPanel\.detailPanel,\s*\.splitBody\.splitBody \.detailPanel\.detailPanel\s*\{[^}]*margin-inline-end: 0;/);
    });
});
