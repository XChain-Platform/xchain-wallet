// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The status word under each My orders row's ring never truncates (operator
// 2026-11-15: "Par...", "Clo...", "Expi..." at 360 px and text scale 1.3).
// The word takes its natural width; the title and meta give way instead.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { OrderRow } from '../../../packages/core/src/shared/routes/OrderRow.jsx';
import { ORDER_STATUS_LABELS } from '../../../packages/core/src/shared/utils/orderView.js';

afterEach(cleanup);

const CHAIN = 'dogecoin-testnet';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

function item(extra = {}, fill = null) {
    return {
        chainId: CHAIN,
        owner: { address: 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc' },
        key: `${CHAIN}:7`,
        fill,
        row: {
            action_index: '7',
            source: 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc',
            give_tick: 'DOGESWAP',
            give_coin: 'DOGE',
            give_amount: '500',
            give_ownership: 0,
            get_tick: null,
            get_coin: 'DOGE',
            get_amount: '10.5',
            get_ownership: 0,
            expiration: FUTURE,
            block_index: '67882087',
            status: 'valid',
            ...extra,
        },
    };
}

const FILLS = {
    open: null,
    partly: { status: 'open', giveRemaining: '100', expiration: String(FUTURE) },
    filled: { status: 'complete', giveRemaining: '0', expiration: String(FUTURE) },
    cancelling: null,
    cancelled: null,
    expiring: null,
    expired: null,
    invalid: null,
};

const css = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('My orders status word at the narrow layout', () => {
    for (const status of Object.keys(ORDER_STATUS_LABELS)) {
        it(`${status} renders in full under the ring with the natural-width column`, () => {
            const fill = status === 'partly' ? FILLS.partly : FILLS[status];
            const base = status === 'partly' ? 'open' : status;
            const { container } = render(<OrderRow item={item({}, fill)} status={base} onOpen={() => {}} />);
            const ring = container.querySelector('[data-fill-ring]');
            expect(ring).not.toBeNull();
            // The fit column, not the fixed clipping status column.
            expect(ring.getAttribute('data-column')).toBe('fit');
            const caption = ring.lastElementChild;
            const expected = status === 'partly' ? 'Partly' : ORDER_STATUS_LABELS[status];
            const shown = ring.getAttribute('data-status') === 'partly' ? 'Partly' : ORDER_STATUS_LABELS[ring.getAttribute('data-status')];
            expect(caption.textContent).toBe(shown || expected);
            // No inline truncation on the word.
            expect(caption.getAttribute('style') || '').not.toMatch(/ellipsis|overflow|max-width/);
        });
    }

    it('the fit column overrides every truncation rule and the slot never shrinks', () => {
        const ringCss = css('../../../packages/core/src/shared/components/FillRing.module.css');
        const fitRule = ringCss.match(/\.fillRing\[data-column='fit'\] \.caption\s*\{([^}]*)\}/);
        expect(fitRule).not.toBeNull();
        expect(fitRule[1]).toMatch(/max-inline-size:\s*none/);
        expect(fitRule[1]).toMatch(/overflow:\s*visible/);
        expect(fitRule[1]).toMatch(/text-overflow:\s*clip/);
        const colRule = ringCss.match(/\.fillRing\[data-column='fit'\]\s*\{([^}]*)\}/);
        expect(colRule).not.toBeNull();
        expect(colRule[1]).not.toMatch(/(^|[\s;])(max-inline-size|max-width|width|inline-size)\s*:/);
        const rowCss = css('../../../packages/core/src/shared/routes/ObligationsView.module.css');
        const slot = rowCss.match(/\.ringSlot\s*\{([^}]*)\}/);
        expect(slot[1]).toMatch(/flex:\s*0 0 auto/);
        expect(slot[1]).toMatch(/max-width:\s*none/);
    });
});
