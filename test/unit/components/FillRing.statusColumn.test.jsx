// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A list row's fill ring sits in a fixed-width status column (operator
// 2026-11-14), so a longer status word can never push the ring away from the
// row's chevron, and a cancelled order or swap reads Closed, not Cancelled.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { FillRing } from '../../../packages/core/src/shared/components/FillRing.jsx';
import { orderStatusLabel } from '../../../packages/core/src/shared/utils/orderView.js';
import { orderRingCaption } from '../../../packages/core/src/shared/routes/OrderRow.jsx';
import { swapStatusLabel } from '../../../packages/core/src/shared/components/SwapRow.jsx';

const css = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/FillRing.module.css',
), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    // Anchored at a line start so a descendant rule never stands in for it.
    return new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] || '';
}

describe('fill ring status column and the Closed label', () => {
    afterEach(cleanup);

    it('marks a list ring as the status column and the large ring as not', () => {
        const { container } = render(
            <div>
                <FillRing percent={0} tone="muted" mark="cross" caption="Closed" status="cancelled" />
                <FillRing percent={62} tone="warning" caption="Expiring" status="expiring" />
                <FillRing percent={100} tone="success" mark="tick" size="lg" status="filled" />
            </div>,
        );
        const rings = [...container.querySelectorAll('[data-fill-ring]')];
        expect(rings.map((r) => r.getAttribute('data-column'))).toEqual(['status', 'status', null]);
    });

    it('gives the status column one fixed width that never flexes with its word', () => {
        const body = ruleBody(".fillRing[data-column='status']");
        // The ring's width plus a little air (operator 2026-11-15 on
        // Obligations), the same value for all three so it never flexes.
        const declared = (prop) => new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(body)?.[1].trim();
        const width = declared('inline-size');
        expect(width).toBeTruthy();
        expect(width).toContain('var(--fill-ring-size)');
        expect(declared('min-inline-size')).toBe(width);
        expect(declared('max-inline-size')).toBe(width);
    });

    it('clips a longer caption inside the column and centres the ring in it', () => {
        const caption = ruleBody('.caption');
        expect(caption).toMatch(/overflow:\s*hidden/);
        expect(caption).toMatch(/white-space:\s*nowrap/);
        expect(caption).toMatch(/text-overflow:\s*ellipsis/);
        expect(caption).toMatch(/max-inline-size:\s*100%/);
        const column = ruleBody('.fillRing');
        expect(column).toMatch(/flex-direction:\s*column/);
        expect(column).toMatch(/align-items:\s*center/);
    });

    it('words a cancelled order, a cancel in flight and a cancelled swap as Closed and Closing', () => {
        expect(orderStatusLabel('cancelled')).toBe('Closed');
        expect(orderStatusLabel('cancelling')).toBe('Closing');
        expect(orderRingCaption('cancelled')).toBe('Closed');
        expect(swapStatusLabel('cancelled')).toBe('Closed');
        expect(swapStatusLabel('cancelling')).toBe('Closing');
    });
});
