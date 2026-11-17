// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
    formatCompactChartValue,
    Sparkline,
    describeChartSeries,
    synthesizeTokenChart,
} from '../../../packages/core/src/shared/components/Sparkline.jsx';
import { registerLocale, setLocale } from '../../../packages/core/src/i18n/index.js';

afterEach(async () => {
    await setLocale('en');
});

describe('Sparkline', () => {
    it.each([null, '1,2', {}, [], [NaN, Infinity]])('renders nothing for an unusable series', (series) => {
        const { container } = render(<Sparkline series={series} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders scaled points inside the viewBox and an accessible data summary', () => {
        render(<Sparkline series={[1, 3]} />);

        const image = screen.getByRole('img', {
            name: 'Price trend. Values range from 1 to 3. Start 1. End 3. Change +2 (+200.00%).',
        });
        expect(image.tagName).toBe('svg');
        expect(image.querySelector('polyline')?.getAttribute('points'))
            .toBe('1.00,99.00 99.00,1.00');
        expect(image.querySelector('title')).toHaveTextContent(
            'Price trend. Values range from 1 to 3. Start 1. End 3. Change +2 (+200.00%).',
        );
    });

    it('includes range context and formatted falling values in its summary', () => {
        render(
            <Sparkline
                series={[12, 9]}
                label="Portfolio chart"
                rangeLabel="24h"
                formatValue={(value) => `$${value.toFixed(2)}`}
            />,
        );

        expect(screen.getByRole('img')).toHaveAccessibleName(
            'Portfolio chart. Range 24h. Values range from $9.00 to $12.00. Start $12.00. End $9.00. Change -$3.00 (-25.00%).',
        );
    });

    it('shows compact high, middle and low labels with matching guides', () => {
        const format = (value) => formatCompactChartValue(value, { locale: 'en-US', currency: 'USD' });
        const { container } = render(
            <Sparkline
                series={[2_600_000, 3_200_000, 2_800_000]}
                rangeLabel="1W"
                showScale
                formatValue={format}
                formatScaleValue={format}
            />,
        );

        expect([...container.querySelectorAll('[data-chart-scale]')].map((node) => node.textContent))
            .toEqual(['$3.2M', '$2.9M', '$2.6M']);
        expect([...container.querySelectorAll('[data-chart-guide]')].map((node) => node.getAttribute('data-chart-guide')))
            .toEqual(['high', 'middle', 'low']);
        expect(screen.getByRole('img')).toHaveAccessibleName(/Range high \$3\.2M, low \$2\.6M/);
        expect(formatCompactChartValue(3_200_000, { locale: 'de-DE', currency: 'EUR' }))
            .toMatch(/^3,2.*€$/);
    });

    it('updates the scale unit and collapses a flat range to one label', () => {
        const fiat = (value) => formatCompactChartValue(value, { locale: 'en-US', currency: 'USD' });
        const coin = (value) => formatCompactChartValue(value, { locale: 'en-US', unit: 'BTC' });
        const { container, rerender } = render(
            <Sparkline series={[2_600_000, 3_200_000]} showScale formatValue={fiat} formatScaleValue={fiat} />,
        );

        rerender(<Sparkline series={[2.6, 3.2]} showScale formatValue={coin} formatScaleValue={coin} />);
        expect([...container.querySelectorAll('[data-chart-scale]')].map((node) => node.textContent))
            .toEqual(['3.2 BTC', '2.9 BTC', '2.6 BTC']);

        rerender(<Sparkline series={[7, 7, 7]} showScale formatValue={coin} formatScaleValue={coin} />);
        expect(container.querySelectorAll('[data-chart-scale]')).toHaveLength(1);
        expect(container.querySelector('[data-chart-scale="flat"]')).toHaveTextContent('7 BTC');
    });

    it('shows no scale labels when the series is empty', () => {
        const { container } = render(<Sparkline series={[]} showScale />);
        expect(container.querySelector('[data-chart-scale]')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('uses semantic theme tokens for rising, falling, and flat series', () => {
        const { container, rerender } = render(<Sparkline series={[1, 3]} />);
        expect(container.querySelector('polyline')?.getAttribute('stroke'))
            .toBe('var(--xc-success)');

        act(() => rerender(<Sparkline series={[2, 2]} />));
        expect(container.querySelector('polyline')?.getAttribute('stroke'))
            .toBe('var(--xc-text-muted)');
        expect(container.querySelector('polyline')?.getAttribute('points'))
            .toBe('1.00,50.00 99.00,50.00');

        act(() => rerender(<Sparkline series={[3, 1]} />));
        expect(container.querySelector('polyline')?.getAttribute('stroke'))
            .toBe('var(--xc-danger)');
        expect(screen.getByRole('img', { name: /^Price trend\. .*Change -2 / })).toBeInTheDocument();
    });

    it('renders a centered mark for one finite point and ignores invalid samples', () => {
        const { container } = render(<Sparkline series={[NaN, 42, Infinity]} />);

        expect(container.querySelector('polyline')?.getAttribute('points'))
            .toBe('48.00,50.00 52.00,50.00');
        expect(screen.getByRole('img', { name: /^Price trend\. .*Change 0 \(0\.00%\)/ })).toBeInTheDocument();
    });

    it('uses the active dictionary and number locale for the summary', async () => {
        registerLocale('de-DE', {
            'components.sparkline.summary': '{label}.{rangeState, select, withRange { Zeitraum {range}.} other {}} Werte von {low} bis {high}. Start {start}. Ende {end}. Änderung {change}{percentageState, select, withPercentage { ({percentage})} other {}}.',
        });
        await setLocale('de-DE');

        expect(describeChartSeries([0, 1234.5], {
            label: 'Preistrend',
            rangeLabel: '1T',
        })).toBe('Preistrend. Zeitraum 1T. Werte von 0 bis 1.234,5. Start 0. Ende 1.234,5. Änderung +1.234,5.');
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
