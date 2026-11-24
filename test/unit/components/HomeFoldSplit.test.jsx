// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    HOME_DUO_BOOK_FALLBACK_PX,
    HOME_DUO_BOOK_WIDTH_PX,
    HOME_WIDE_MIN_PX,
    HomeWideLayout,
    isHomeDuoBookSplit,
    useHomeWide,
} from '../../../packages/core/src/shared/components/HomeWideLayout.jsx';
import { PANEL_SPLIT_GUTTER_PX } from '../../../packages/core/src/shared/components/PanelSplit.jsx';

const states = JSON.parse(
    readFileSync('test/fixtures/duo/measured-widths.json', 'utf8'),
).states;

function Probe({ width, layout = false }) {
    const [ref, wide] = useHomeWide(HOME_WIDE_MIN_PX, true);
    return (
        <div ref={ref} data-testid="home" data-wide={wide} data-width={width}>
            {wide && layout ? (
                <HomeWideLayout
                    hero={<div>Wallet balance</div>}
                    allocation={<div>Allocation</div>}
                    listHeader={<div>Balance filters</div>}
                    list={<div>Balances left</div>}
                    detail={<div>Selected token</div>}
                    detailLabel="Token detail"
                />
            ) : null}
        </div>
    );
}

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        const declaredWidth = Number(this.dataset.width);
        const width = Number.isFinite(declaredWidth) ? declaredWidth : HOME_DUO_BOOK_WIDTH_PX;
        return { width, left: 0, right: width };
    });
    vi.stubGlobal('ResizeObserver', undefined);
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    delete globalThis.__xchainNativeFold;
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Home Duo fold split', () => {
    it('binds the Book constant to measured evidence or its named fallback', () => {
        const book = states['open-portrait'];
        if (Number.isFinite(book.width)) {
            expect(book.width).toBeGreaterThan(0);
            expect(HOME_DUO_BOOK_WIDTH_PX).toBe(book.width);
        } else {
            expect(typeof book.unreachable).toBe('string');
            expect(book.unreachable.trim()).not.toBe('');
            expect(HOME_DUO_BOOK_WIDTH_PX).toBe(HOME_DUO_BOOK_FALLBACK_PX);
        }
    });

    it('keeps measured closed portrait in one column', () => {
        expect(states['closed-portrait'].width).toBe(466);
        vi.stubGlobal('innerWidth', states['closed-portrait'].width);
        globalThis.__xchainNativeFold = { division: { orientation: 'none' } };
        render(<Probe width={states['closed-portrait'].width} />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it('splits at the Book width only for a finite vertical fold', () => {
        const dividerX = 475.5;
        const foldDivision = { vertical: true, dividerX };
        vi.stubGlobal('innerWidth', HOME_DUO_BOOK_WIDTH_PX);
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: dividerX, y: 0 },
        };
        render(<Probe width={HOME_DUO_BOOK_WIDTH_PX} layout />);

        expect(isHomeDuoBookSplit(HOME_DUO_BOOK_WIDTH_PX, foldDivision)).toBe(true);
        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'true');
        expect(screen.getByText('Balances left')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Token detail' })).toHaveTextContent('Selected token');
        expect(screen.getByRole('separator')).toHaveAttribute(
            'aria-valuenow',
            String(Math.round(dividerX - ((PANEL_SPLIT_GUTTER_PX - 1) / 2))),
        );
    });

    it('keeps another narrow width in one column with a finite vertical fold', () => {
        const width = HOME_DUO_BOOK_WIDTH_PX - 1;
        const foldDivision = { vertical: true, dividerX: 475.5 };
        vi.stubGlobal('innerWidth', width);
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 475.5 },
        };
        render(<Probe width={width} />);

        expect(isHomeDuoBookSplit(width, foldDivision)).toBe(false);
        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it.each([
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['a missing value', undefined],
    ])('keeps one column for a vertical fold with %s divider', (_label, x) => {
        vi.stubGlobal('innerWidth', HOME_DUO_BOOK_WIDTH_PX);
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x },
        };
        render(<Probe width={HOME_DUO_BOOK_WIDTH_PX} />);

        expect(isHomeDuoBookSplit(
            HOME_DUO_BOOK_WIDTH_PX,
            { vertical: true, dividerX: x },
        )).toBe(false);
        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it.each([
        [
            'a horizontal fold',
            { orientation: 'horizontal', x: 475.5, y: 300 },
            { vertical: false, dividerX: 475.5 },
        ],
        ['no fold', null, { vertical: false, dividerX: null }],
    ])('keeps one column for %s', (_label, division, foldDivision) => {
        const width = HOME_DUO_BOOK_WIDTH_PX;
        vi.stubGlobal('innerWidth', width);
        globalThis.__xchainNativeFold = { division };
        render(<Probe width={width} />);

        expect(isHomeDuoBookSplit(width, foldDivision)).toBe(false);
        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it.each([
        HOME_WIDE_MIN_PX,
        HOME_WIDE_MIN_PX + 1,
    ])('keeps the existing wide layout at content width %i without a fold', (width) => {
        vi.stubGlobal('innerWidth', 1200);
        globalThis.__xchainNativeFold = { division: null };
        render(<Probe width={width} />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'true');
    });
});
