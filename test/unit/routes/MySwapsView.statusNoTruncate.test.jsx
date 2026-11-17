// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The status word under each My swaps row's ring never truncates (operator
// 2026-11-15: "Set...", "Clo...", "Expi..." at 360 px and text scale 1.3),
// the same ruling as My orders: the word takes its natural width and the
// title and meta give way instead.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { SwapRow, swapStatusLabel } from '../../../packages/core/src/shared/components/SwapRow.jsx';

afterEach(cleanup);

const CHAIN = 'dogecoin-testnet';
const STATUSES = ['open', 'settled', 'cancelling', 'cancelled', 'expired', 'invalid'];
const FULL_WORDS = {
    open: 'Open',
    settled: 'Settled',
    cancelling: 'Closing',
    cancelled: 'Closed',
    expired: 'Expired',
    invalid: 'Invalid',
};

const row = {
    action_index: '9',
    source: 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc',
    give_tick: 'DOGESWAP',
    give_coin: 'DOGE',
    give_amount: '500',
    give_ownership: 0,
    get_tick: null,
    get_coin: 'DOGE',
    get_amount: '10.5',
    get_ownership: 0,
    block_index: '67882087',
};

const css = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('My swaps status word at the narrow layout', () => {
    for (const status of STATUSES) {
        it(`${status} renders in full under the ring with the natural-width column`, () => {
            const { container } = render(
                <SwapRow give="500 DOGESWAP" get="10.5 DOGE" status={status} actionIndex="9" row={row} chainId={CHAIN} onOpen={() => {}} />,
            );
            const ring = container.querySelector('[data-fill-ring]');
            expect(ring).not.toBeNull();
            expect(ring.getAttribute('data-column')).toBe('fit');
            const caption = ring.lastElementChild;
            expect(caption.textContent).toBe(swapStatusLabel(status));
            expect(caption.textContent).toBe(FULL_WORDS[status]);
            expect(caption.getAttribute('style') || '').not.toMatch(/ellipsis|overflow|max-width/);
        });
    }

    it('the row puts the ring in the never-shrinking ring slot', () => {
        const src = css('../../../packages/core/src/shared/components/SwapRow.jsx');
        expect(src).toMatch(/trailingClassName=\{L\.ringSlot\}/);
        const rowCss = css('../../../packages/core/src/shared/routes/ObligationsView.module.css');
        const slot = rowCss.match(/\.ringSlot\s*\{([^}]*)\}/);
        expect(slot[1]).toMatch(/flex:\s*0 0 auto/);
        expect(slot[1]).toMatch(/max-width:\s*none/);
    });

    it('the fit column overrides every truncation rule', () => {
        const ringCss = css('../../../packages/core/src/shared/components/FillRing.module.css');
        const fitRule = ringCss.match(/\.fillRing\[data-column='fit'\] \.caption\s*\{([^}]*)\}/);
        expect(fitRule).not.toBeNull();
        expect(fitRule[1]).toMatch(/max-inline-size:\s*none/);
        expect(fitRule[1]).toMatch(/overflow:\s*visible/);
        expect(fitRule[1]).toMatch(/text-overflow:\s*clip/);
    });
});
