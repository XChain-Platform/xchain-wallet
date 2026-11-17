// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
    formatCompactChartValue,
    HERO_SCALE_PLOT,
    Sparkline,
    synthesizeTokenChart,
} from '../../../packages/core/src/shared/components/Sparkline.jsx';

const SPARKLINE_CSS = readFileSync('packages/core/src/shared/components/Sparkline.module.css', 'utf8');
const HERO_CSS = readFileSync('packages/core/src/shared/components/TotalBalanceHero.module.css', 'utf8');
const HOME_TABS_CSS = readFileSync('packages/core/src/shared/components/HomeTabs.module.css', 'utf8');
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

    it('shows five evenly spaced compact labels on alternating lines in a nine-guide grid', () => {
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
            .toEqual([
                'high',
                'high-upper-middle-halfway',
                'upper-middle',
                'upper-middle-middle-halfway',
                'middle',
                'middle-lower-middle-halfway',
                'lower-middle',
                'lower-middle-low-halfway',
                'low',
            ]);
        expect(screen.getByRole('img')).toHaveAccessibleName(/Range high \$3\.2M, low \$2\.6M/);
        expect(formatCompactChartValue(3_200_000, { locale: 'de-DE', currency: 'EUR' }))
            .toMatch(/^3,2.*€$/);
    });

    it('maps the hero line, labels, and full-width guides through the full hero height', () => {
        const props = {
            series: [2, 5, 3],
            height: '100%',
            edgeToEdge: true,
            areaFill: 'purple',
        };
        const { container } = render(<Sparkline {...props} showScale heroScale />);
        const scaledPlot = container.querySelector('svg');
        const geometry = {
            viewBox: scaledPlot.getAttribute('viewBox'),
            preserveAspectRatio: scaledPlot.getAttribute('preserveAspectRatio'),
            line: scaledPlot.querySelector('polyline').getAttribute('points'),
            area: scaledPlot.querySelector('polygon').getAttribute('points'),
            height: scaledPlot.parentElement.style.height,
        };
        expect(geometry).toEqual({
            viewBox: '0 0 100 100',
            preserveAspectRatio: 'none',
            line: '0.00,96.00 50.00,4.00 100.00,65.33',
            area: '0,100 0.00,96.00 50.00,4.00 100.00,65.33 100,100',
            height: '100%',
        });
        const line = scaledPlot.querySelector('polyline');
        const scaleBand = container.querySelector('div[data-chart-scale-band="hero"]');
        const guides = [...scaledPlot.querySelectorAll('[data-chart-guide]')];
        expect(guides.map((guide) => ({
            x1: guide.getAttribute('x1'),
            x2: guide.getAttribute('x2'),
            y: guide.getAttribute('y1'),
        }))).toEqual([
            { x1: '0', x2: '100', y: '4' },
            { x1: '0', x2: '100', y: '15.5' },
            { x1: '0', x2: '100', y: '27' },
            { x1: '0', x2: '100', y: '38.5' },
            { x1: '0', x2: '100', y: '50' },
            { x1: '0', x2: '100', y: '61.5' },
            { x1: '0', x2: '100', y: '73' },
            { x1: '0', x2: '100', y: '84.5' },
            { x1: '0', x2: '100', y: '96' },
        ]);
        expect(guides.map((guide) => guide.getAttribute('data-chart-guide-kind')))
            .toEqual(['labelled', 'halfway', 'labelled', 'halfway', 'labelled', 'halfway', 'labelled', 'halfway', 'labelled']);
        expect([...container.querySelectorAll('[data-chart-scale]')].map((label) => ({
            position: label.getAttribute('data-scale-position'),
            top: label.style.top,
        }))).toEqual([
            { position: 'top', top: '4%' },
            { position: 'upper-middle', top: '27%' },
            { position: 'middle', top: '50%' },
            { position: 'lower-middle', top: '73%' },
            { position: 'bottom', top: '96%' },
        ]);
        expect(line.compareDocumentPosition(guides[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(scaledPlot.compareDocumentPosition(scaleBand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(Math.min(...geometry.line.match(/,(\d+(?:\.\d+)?)/g).map((value) => Number(value.slice(1))))).toBe(HERO_SCALE_PLOT.top);
        expect(Math.max(...geometry.line.match(/,(\d+(?:\.\d+)?)/g).map((value) => Number(value.slice(1))))).toBe(HERO_SCALE_PLOT.bottom);
        expect(geometry.area.endsWith('100,100')).toBe(true);
        expect(SPARKLINE_CSS).toMatch(/\.plot\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
        expect(SPARKLINE_CSS).toMatch(/\.guide\s*\{[^}]*stroke-width:\s*1;[^}]*opacity:\s*0\.45;/s);
        expect(SPARKLINE_CSS).toMatch(/\.guideHero\s*\{[^}]*stroke:\s*var\(--xc-hero-guide\);[^}]*opacity:\s*var\(--xc-hero-guide-opacity\);/s);
        expect(SPARKLINE_CSS).toMatch(/\.guideHero\.guideHalfway\s*\{[^}]*opacity:\s*calc\(var\(--xc-hero-guide-opacity\) \* 0\.65\);/s);
        expect(SPARKLINE_CSS).toMatch(/\.scale\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s);
        expect(SPARKLINE_CSS).toMatch(/\.scale\s*>\s*span\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-end:/s);
    });

    it.each([
        ['phone', 402, 'light'],
        ['phone', 402, 'dark'],
        ['iPad', 820, 'light'],
        ['iPad', 820, 'dark'],
        ['desktop', 1440, 'light'],
        ['desktop', 1440, 'dark'],
        ['wide Home asset detail', 1440, 'light'],
        ['wide Home asset detail', 1440, 'dark'],
    ])('keeps all five %s hero labels on full-height lines at %ipx in %s mode', (_name, _width) => {
        const height = 160;
        const band = { top: height * (HERO_SCALE_PLOT.top / 100), bottom: height * (HERO_SCALE_PLOT.bottom / 100) };
        const ratios = [0, 0.25, 0.5, 0.75, 1];
        const labels = ratios.map((ratio) => {
            const center = band.top + ((band.bottom - band.top) * ratio);
            return { top: center - 6, bottom: center + 6 };
        });
        expect(band).toEqual({ top: 6.4, bottom: 153.6 });
        expect(labels.every((label, index) => index === 0 || label.top >= labels[index - 1].bottom)).toBe(true);
        expect(HERO_SCALE_PLOT).toEqual({ left: 0, right: 100, top: 4, bottom: 96 });
        expect(SPARKLINE_CSS).not.toMatch(/data-scale-position='upper-middle'[\s\S]*display:\s*none/);
    });

    it('pins every hero label to one right-edge column and stacks solid controls above it', () => {
        const { container } = render(<Sparkline series={[2, 5, 3]} height="100%" showScale heroScale />);
        const labels = [...container.querySelectorAll('[data-chart-scale]')];
        expect(labels.map((label) => label.style.top)).toEqual(['4%', '27%', '50%', '73%', '96%']);
        expect(labels.every((label) => !label.hasAttribute('data-scale-collision'))).toBe(true);
        expect(SPARKLINE_CSS).toMatch(/\.scale\s*>\s*span\s*\{[^}]*inset-inline-end:\s*var\(--xc-space-1\);/s);
        expect(SPARKLINE_CSS).not.toMatch(/data-scale-collision/);
        expect(SPARKLINE_CSS).toMatch(/\.scale\s*\{[^}]*z-index:\s*1;/s);
        expect(HOME_TABS_CSS).toMatch(/\.heroStack\s*>\s*section:first-child\s*\{[^}]*z-index:\s*2;/s);
        expect(PORTFOLIO_CSS).toMatch(/\.behind \.ranges,[\s\S]*?\.behind \.foot\s*\{[^}]*z-index:\s*2;/s);
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

    it('keeps chart controls on opaque surfaces with bordered selected and unselected states', () => {
        expect(TOKENS_CSS).toMatch(/--xc-hero-chip-bg:\s*#FFFFFF;/);
        expect(TOKENS_CSS.match(/--xc-hero-chip-bg:\s*var\(--xc-surface\);/g)).toHaveLength(2);
        expect(PORTFOLIO_CSS).toMatch(/\.behind \.rangeSlot \.rangeLabel\s*\{[^}]*border:\s*1px solid var\(--xc-hero-border\);[^}]*background:\s*var\(--xc-hero-chip-bg\);/s);
        expect(PORTFOLIO_CSS).toMatch(/\.behind \.rangeSlot\.rangeActive \.rangeLabel[^}]*\{[^}]*background:\s*var\(--xc-hero-chip-selected-bg\);/s);
        expect(HERO_CSS).toMatch(/\.eye\s*\{[^}]*background:\s*var\(--xc-hero-chip-bg\);[^}]*border:\s*1px solid var\(--xc-hero-border\);/s);
        expect(HERO_CSS).not.toMatch(/\.eye(?:\.eye)?(?::hover)?\s*\{[^}]*background:[^;]*(?:transparent|rgba\()/s);
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

    it('shares one scale across stepped primary and dashed secondary series', () => {
        const { container } = render(
            <Sparkline
                series={[0, 10, 5]}
                secondarySeries={[0, 12, 8]}
                label="Staked"
                secondaryLabel="Staked + rewards"
                secondaryDashed
                stepped
                showScale
                heroScale
                formatValue={(value) => `${value} XCHAIN`}
                formatScaleValue={(value) => `${value} XCHAIN`}
            />,
        );

        const primary = container.querySelector('[data-chart-series="primary"]');
        const secondary = container.querySelector('[data-chart-series="secondary"]');
        expect(primary).toHaveAttribute('points', '0.00,96.00 50.00,96.00 50.00,19.33 100.00,19.33 100.00,57.67');
        expect(primary).toHaveAttribute('stroke-width', '2');
        expect(secondary).toHaveAttribute('points', '0.00,96.00 50.00,96.00 50.00,4.00 100.00,4.00 100.00,34.67');
        expect(secondary).toHaveAttribute('stroke-width', '1.25');
        expect(secondary).toHaveAttribute('stroke-dasharray', '4 3');
        expect([...container.querySelectorAll('[data-chart-scale]')].map((node) => node.textContent))
            .toEqual(['12 XCHAIN', '9 XCHAIN', '6 XCHAIN', '3 XCHAIN', '0 XCHAIN']);
        expect(container.querySelectorAll('[data-chart-guide]')).toHaveLength(9);
        expect(screen.getByRole('img')).toHaveAccessibleName(/Staked \+ rewards\./);
    });

    it('uses the visible reward series to set direction when principal is flat', () => {
        const { container } = render(
            <Sparkline
                series={[10, 10]}
                secondarySeries={[10, 12]}
                secondaryDashed
                heroScale
            />,
        );

        expect(container.querySelector('[data-chart-series="primary"]')).toHaveAttribute('data-chart-tone', 'up');
        expect(container.querySelector('[data-chart-series="secondary"]')).toHaveAttribute('data-chart-tone', 'up');
        expect(container.querySelector('[data-chart-series="primary"]')).toHaveAttribute('stroke', 'var(--xc-hero-chart-up)');
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
