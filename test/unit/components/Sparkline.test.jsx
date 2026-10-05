// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
    Sparkline,
    synthesizeTokenChart,
} from '../../../packages/core/src/shared/components/Sparkline.jsx';

describe('Sparkline', () => {
    it.each([null, '1,2', {}, [], [1]])('renders nothing for an unusable series', (series) => {
        const { container } = render(<Sparkline series={series} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the scaled points and accessible image label', () => {
        render(<Sparkline series={[1, 3]} />);

        const image = screen.getByRole('img', { name: 'Price trend' });
        expect(image.tagName).toBe('svg');
        expect(image.querySelector('polyline')?.getAttribute('points'))
            .toBe('0.00,100.00 100.00,0.00');
    });

    it('uses the positive stroke for rising and flat series', () => {
        const { container, rerender } = render(<Sparkline series={[1, 3]} />);
        expect(container.querySelector('polyline')?.getAttribute('stroke'))
            .toBe('var(--xc-success, #14b86c)');

        act(() => rerender(<Sparkline series={[2, 2]} />));
        expect(container.querySelector('polyline')?.getAttribute('stroke'))
            .toBe('var(--xc-success, #14b86c)');
    });

    it('uses the negative stroke for a falling series', () => {
        const { container } = render(<Sparkline series={[3, 1]} />);
        expect(container.querySelector('polyline')?.getAttribute('stroke'))
            .toBe('var(--xc-danger, #d93838)');
    });
});

describe('synthesizeTokenChart', () => {
    it.each(['1', null, NaN, Infinity, -Infinity, 0, -1])(
        'rejects an invalid current price',
        (currentPrice) => {
            expect(synthesizeTokenChart('asset', currentPrice)).toEqual({
                sparkline: null,
                change24hPct: null,
            });
        },
    );

    it('uses the requested, default, and minimum sample counts', () => {
        expect(synthesizeTokenChart('asset', 42, 7).sparkline).toHaveLength(7);
        expect(synthesizeTokenChart('asset', 42).sparkline).toHaveLength(168);
        expect(synthesizeTokenChart('asset', 42, 1).sparkline).toHaveLength(2);
    });

    it('ends at the current price and keeps every sample positive', () => {
        const currentPrice = 42;
        const { sparkline } = synthesizeTokenChart('asset', currentPrice, 48);

        expect(sparkline.at(-1)).toBe(currentPrice);
        expect(sparkline.every((sample) => sample > 0)).toBe(true);
    });

    it('is stable per asset key and varies across asset keys', () => {
        const first = synthesizeTokenChart('asset-a', 42, 48);
        const repeat = synthesizeTokenChart('asset-a', 42, 48);
        const other = synthesizeTokenChart('asset-b', 42, 48);

        expect(repeat.sparkline).toEqual(first.sparkline);
        expect(other.sparkline).not.toEqual(first.sparkline);
        expect(Number.isFinite(first.change24hPct)).toBe(true);
    });
});
