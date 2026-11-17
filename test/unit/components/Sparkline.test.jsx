// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { readFileSync } from 'node:fs';
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

const SPARKLINE_CSS = readFileSync('packages/core/src/shared/components/Sparkline.module.css', 'utf8');
const HERO_CSS = readFileSync('packages/core/src/shared/components/TotalBalanceHero.module.css', 'utf8');
const PORTFOLIO_CSS = readFileSync('packages/core/src/shared/components/PortfolioChart.module.css', 'utf8');
const TOKENS_CSS = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

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

    it('shows five evenly spaced compact labels with matching guides', () => {
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
            .toEqual(['$3.2M', '$3.05M', '$2.9M', '$2.75M', '$2.6M']);
        expect([...container.querySelectorAll('[data-chart-guide]')].map((node) => node.getAttribute('data-chart-guide')))
            .toEqual(['high', 'upper-middle', 'middle', 'lower-middle', 'low']);
        expect(screen.getByRole('img')).toHaveAccessibleName(/Range high \$3\.2M, low \$2\.6M/);
        expect(formatCompactChartValue(3_200_000, { locale: 'de-DE', currency: 'EUR' }))
            .toMatch(/^3,2.*€$/);
    });

    it('overlays scale marks without changing the full-bleed chart geometry', () => {
        const props = {
            series: [2, 5, 3],
            height: '100%',
            edgeToEdge: true,
            areaFill: 'purple',
        };
        const { container, rerender } = render(<Sparkline {...props} />);
        const plainPlot = container.querySelector('svg');
        const plainGeometry = {
            viewBox: plainPlot.getAttribute('viewBox'),
            preserveAspectRatio: plainPlot.getAttribute('preserveAspectRatio'),
            line: plainPlot.querySelector('polyline').getAttribute('points'),
            area: plainPlot.querySelector('polygon').getAttribute('points'),
            height: plainPlot.parentElement.style.height,
        };

        rerender(<Sparkline {...props} showScale heroScale />);
        const scaledPlot = container.querySelector('svg');
        expect({
            viewBox: scaledPlot.getAttribute('viewBox'),
            preserveAspectRatio: scaledPlot.getAttribute('preserveAspectRatio'),
            line: scaledPlot.querySelector('polyline').getAttribute('points'),
            area: scaledPlot.querySelector('polygon').getAttribute('points'),
            height: scaledPlot.parentElement.style.height,
        }).toEqual(plainGeometry);
        expect(plainGeometry).toEqual({
            viewBox: '0 0 100 100',
            preserveAspectRatio: 'none',
            line: '0.00,99.00 50.00,1.00 100.00,66.33',
            area: '0,100 0.00,99.00 50.00,1.00 100.00,66.33 100,100',
            height: '100%',
        });
        const guidePlot = container.querySelector('svg[data-chart-scale-band="hero"]');
        const linePlot = container.querySelector('svg[data-chart-line-overlay="hero"]');
        const scaleBand = container.querySelector('div[data-chart-scale-band="hero"]');
        expect([...guidePlot.querySelectorAll('[data-chart-guide]')].map((guide) => ({
            x1: guide.getAttribute('x1'),
            x2: guide.getAttribute('x2'),
            y: guide.getAttribute('y1'),
        }))).toEqual([
            { x1: '0', x2: '100', y: '0' },
            { x1: '0', x2: '100', y: '25' },
            { x1: '0', x2: '100', y: '50' },
            { x1: '0', x2: '100', y: '75' },
            { x1: '0', x2: '100', y: '100' },
        ]);
        expect([...container.querySelectorAll('[data-chart-scale]')].map((label) => ({
            position: label.getAttribute('data-scale-position'),
            top: label.style.top,
        }))).toEqual([
            { position: 'top', top: '0%' },
            { position: 'upper-middle', top: '25%' },
            { position: 'middle', top: '50%' },
            { position: 'lower-middle', top: '75%' },
            { position: 'bottom', top: '100%' },
        ]);
        expect(guidePlot.compareDocumentPosition(linePlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(linePlot.compareDocumentPosition(scaleBand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(linePlot.querySelector('polyline').getAttribute('points')).toBe(plainGeometry.line);
        expect(guidePlot.getAttribute('class')).toContain(scaleBand.getAttribute('class').split(' ').at(-1));
        expect(SPARKLINE_CSS).toMatch(/\.plot\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
        expect(SPARKLINE_CSS).toMatch(/\.guide\s*\{[^}]*stroke-width:\s*1;[^}]*opacity:\s*0\.45;/s);
        expect(SPARKLINE_CSS).toMatch(/\.guideHero\s*\{[^}]*stroke:\s*var\(--xc-hero-guide\);[^}]*opacity:\s*var\(--xc-hero-guide-opacity\);/s);
        expect(SPARKLINE_CSS).toMatch(/\.scale\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s);
        expect(SPARKLINE_CSS).toMatch(/\.scale\s*>\s*span\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-end:/s);
    });

    it.each([
        ['phone', 402, 138, 'light'],
        ['phone', 402, 138, 'dark'],
        ['iPad', 820, 138, 'light'],
        ['iPad', 820, 138, 'dark'],
        ['desktop', 1440, 138, 'light'],
        ['desktop', 1440, 138, 'dark'],
        ['compact token phone', 402, 113, 'light'],
        ['compact token phone', 402, 113, 'dark'],
        ['compact token iPad', 820, 113, 'light'],
        ['compact token iPad', 820, 113, 'dark'],
        ['compact token desktop', 1440, 113, 'light'],
        ['compact token desktop', 1440, 113, 'dark'],
        ['wide Home asset detail', 1440, 138, 'light'],
        ['wide Home asset detail', 1440, 138, 'dark'],
    ])('keeps the %s hero scale outside controls at %ipx by %ipx in %s mode', (_name, _width, height) => {
        const control = { top: 8, bottom: 40 };
        const chips = { top: height - 32, bottom: height - 4 };
        const band = { top: 46, bottom: height - 38 };
        const ratios = height <= 131 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
        const labels = ratios.map((ratio) => {
            const center = band.top + ((band.bottom - band.top) * ratio);
            return { top: center - 6, bottom: center + 6 };
        });
        const intersects = (one, two) => one.top < two.bottom && one.bottom > two.top;

        expect(labels.every((label) => !intersects(label, control))).toBe(true);
        expect(labels.every((label) => !intersects(label, chips))).toBe(true);
        expect(labels.every((label, index) => index === 0 || label.top >= labels[index - 1].bottom)).toBe(true);
        expect(SPARKLINE_CSS).toMatch(/\.heroBand\s*\{[^}]*inset-block-start:\s*calc\(var\(--xc-card-pad\) \+ 32px \+ 6px\);[^}]*inset-block-end:\s*calc\(var\(--xc-space-1\) \+ var\(--xc-space-6\) \+ var\(--xc-space-1\) \+ 6px\);/s);
        expect(SPARKLINE_CSS).toMatch(/@container\s*\(max-height:\s*131px\)[\s\S]*upper-middle[\s\S]*lower-middle[\s\S]*display:\s*none;/s);
    });

    it('derives the hero band from the control and chip dimensions', () => {
        expect(HERO_CSS).toMatch(/\.eye\.eye\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s);
        expect(PORTFOLIO_CSS).toMatch(/\.range\s*\{[^}]*height:\s*calc\(var\(--xc-space-6\) \+ var\(--xc-space-1\)\);/s);
        expect(PORTFOLIO_CSS).toMatch(/\.wrap\.behind\s*\{[^}]*padding:\s*0 var\(--xc-card-pad\) var\(--xc-space-1\);/s);
        expect(TOKENS_CSS).toMatch(/--xc-space-1:\s*4px;/);
        expect(TOKENS_CSS).toMatch(/--xc-space-6:\s*24px;/);
        expect(TOKENS_CSS).toMatch(/--xc-card-pad:\s*var\(--xc-space-2\);\s*\/\* 8px everywhere \*\//);
        expect(SPARKLINE_CSS).toMatch(/font-size:\s*max\(12px, var\(--xc-text-xs\)\);[^}]*line-height:\s*1;/s);
    });

    it('updates the scale unit and collapses a flat range to one label', () => {
        const fiat = (value) => formatCompactChartValue(value, { locale: 'en-US', currency: 'USD' });
        const coin = (value) => formatCompactChartValue(value, { locale: 'en-US', unit: 'BTC' });
        const { container, rerender } = render(
            <Sparkline series={[2_600_000, 3_200_000]} showScale formatValue={fiat} formatScaleValue={fiat} />,
        );

        rerender(<Sparkline series={[2.6, 3.2]} showScale formatValue={coin} formatScaleValue={coin} />);
        expect([...container.querySelectorAll('[data-chart-scale]')].map((node) => node.textContent))
            .toEqual(['3.2 BTC', '3.05 BTC', '2.9 BTC', '2.75 BTC', '2.6 BTC']);

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
