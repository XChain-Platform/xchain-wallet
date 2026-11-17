// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wide Home's allocation card (G115) with the donut on the left and a table
// of the top five assets plus Other on the right, each row a dot, the
// ticker, a share bar, Share and Value, under headers that line up with
// their columns and a thin divider.
//
// Vitest blanks CSS modules and jsdom has no layout, so the alignment,
// divider and type rules are read from the stylesheet itself, and the
// height and width checks are sums of the stylesheet's own sizes against
// the room wide Home gives the card. The text widths in WIDEST are measured
// in Chromium with the app font (Inter, 2026-11-15); a real render of the
// card at the 1280 and 1920 content widths agreed (no overflow, card 179px).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
    ALLOCATION_DOT_CONTRAST,
    ALLOCATION_HERO_SURFACES,
    ALLOCATION_OTHER_COLOR,
    AllocationCard,
    allocationSlices,
    contrastRatio,
    formatAllocationValue,
    fitAllocationColor,
} from '../../../packages/core/src/shared/components/AllocationCard.jsx';

const CSS = readFileSync('packages/core/src/shared/components/AllocationCard.module.css', 'utf8');
const JSX = readFileSync('packages/core/src/shared/components/AllocationCard.jsx', 'utf8');
const TOKENS = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
const HERO_CSS = readFileSync('packages/core/src/shared/components/TotalBalanceHero.module.css', 'utf8');

const descriptors = new Map([
    ['bitcoin-mainnet', { coin: 'bitcoin', color: '#F7931A' }],
    ['litecoin-mainnet', { coin: 'litecoin', color: '#345D9D' }],
    ['dogecoin-mainnet', { coin: 'dogecoin', color: '#C2A633' }],
]);
const chainRegistry = { get: (id) => descriptors.get(id) || null };
const row = (chainId, tick, kind, value) => ({ chainId, tick, kind, quantity: String(value), divisibility: 0, fiatRate: 1 });

// The mockup's wallet: 14 priced assets on 3 chains.
const SAMPLE = [
    row('bitcoin-mainnet', 'BTC', 'native', 100000),
    row('bitcoin-mainnet', 'RAREPEPE', 'token', 36500),
    row('bitcoin-mainnet', 'PEPECASH', 'token', 14200),
    row('litecoin-mainnet', 'LTC', 'native', 2400),
    row('bitcoin-mainnet', 'XCP', 'token', 1200),
    row('dogecoin-mainnet', 'DOGE', 'native', 850),
    ...Array.from({ length: 8 }, (_, i) => row('bitcoin-mainnet', `SMALL${i}`, 'token', 700 + i)),
];

/** One rule's declarations, from the first block whose selector matches exactly. */
function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
}

function decl(block, prop) {
    const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`).exec(block);
    return m ? m[1].trim() : null;
}

/** A px length, or a spacing token (var(--xc-space-N)) read from tokens.css. */
function px(value) {
    const text = String(value || '').trim();
    const token = /^var\((--xc-space-\d+)\)$/.exec(text);
    if (token) {
        const m = new RegExp(`${token[1]}:\\s*(\\d+)px;`).exec(TOKENS);
        if (!m) throw new Error(`no token ${token[1]}`);
        return Number(m[1]);
    }
    const m = /^(\d+(?:\.\d+)?)px$/.exec(text);
    if (!m) throw new Error(`not a px value: ${value}`);
    return Number(m[1]);
}

/** The table's header line, divider and padding, plus six rows. */
function tableHeight() {
    const headPad = px(decl(rule(CSS, '.table thead th'), 'padding-block-end'));
    const firstPad = px(decl(rule(CSS, '.table tbody tr:first-child > *'), 'padding-block-start'));
    return cardVar('--xc-allocation-head-h') + headPad + 1 + firstPad + 6 * cardVar('--xc-allocation-row-h');
}

/** The gap between the dot and the ticker. */
function dotGap() {
    return px(decl(rule(CSS, '.assetInner'), 'gap'));
}

function cardVar(name) {
    return px(decl(rule(CSS, '.card'), name));
}

function mount(rows = SAMPLE, props = {}) {
    return render(<AllocationCard rows={rows} chainRegistry={chainRegistry} {...props} />);
}

function bodyRows() {
    const table = screen.getByRole('table', { name: 'Share of the wallet value by asset' });
    return within(table).getAllByRole('row').slice(1);
}

afterEach(() => cleanup());

describe('AllocationCard table', () => {
    it('shows the top five by value plus Other, and names what Other holds', () => {
        mount();
        const names = bodyRows().map((tr) => within(tr).getByRole('rowheader').textContent);
        expect(names).toEqual(['BTC', 'RAREPEPE', 'PEPECASH', 'LTC', 'XCP', 'Other']);
        expect(screen.getByText('Other is DOGE + 8 more')).toBeInTheDocument();
        // The donut's centre counts every asset and chain, folded or not.
        expect(screen.getByText('14')).toBeInTheDocument();
        expect(screen.getByText('assets')).toBeInTheDocument();
        expect(screen.getByText('3 chains')).toBeInTheDocument();
    });

    it('folds nothing when six assets fit, and Other only ever holds two or more', () => {
        const six = SAMPLE.slice(0, 6);
        mount(six);
        expect(bodyRows()).toHaveLength(6);
        expect(screen.queryByText(/^Other/)).toBeNull();
        expect(screen.getByText('by value')).toBeInTheDocument();
        const seven = allocationSlices(SAMPLE.slice(0, 7), chainRegistry);
        expect(seven.slices).toHaveLength(6);
        expect(seven.other).toEqual({ lead: 'DOGE', more: 1 });
    });

    it('gives every row a percent share and a whole-unit value, the shares adding to 100.0', () => {
        mount();
        const cells = bodyRows().map((tr) => within(tr).getAllByRole('cell'));
        const shares = cells.map((c) => c[1].textContent);
        const values = cells.map((c) => c[2].textContent);
        for (const s of shares) expect(s).toMatch(/^\d{1,3}\.\d%$/);
        for (const v of values) expect(v).toMatch(/^\$[\d,]+$/);
        expect(shares.slice(0, 3)).toEqual(['62.2%', '22.7%', '8.8%']);
        expect(values.slice(0, 3)).toEqual(['$100,000', '$36,500', '$14,200']);
        const tenths = shares.reduce((sum, s) => sum + Math.round(Number.parseFloat(s) * 10), 0);
        expect(tenths).toBe(1000);
    });

    it('keeps a share bar in every row as long as its share', () => {
        const { container } = mount();
        const fills = [...container.querySelectorAll('tbody td [aria-hidden="true"] > span')];
        expect(fills).toHaveLength(6);
        const widths = fills.map((f) => Number.parseFloat(f.style.width));
        expect(widths[0]).toBeCloseTo(62.2, 1);
        expect(widths[1]).toBeCloseTo(22.7, 1);
        // The top five run longest first; Other is its own sum, so it can be longer.
        const top = widths.slice(0, 5);
        expect([...top].sort((a, b) => b - a)).toEqual(top);
        expect(fills[0].style.background).not.toBe('');
    });

    it('masks Share, Value and the bars while balances are hidden', () => {
        globalThis.localStorage?.setItem('xc:balancesHidden', '1');
        try {
            const { container } = mount();
            for (const tr of bodyRows()) {
                const [, share, value] = within(tr).getAllByRole('cell');
                expect(share.textContent).toBe('•••');
                expect(value.textContent).toBe('•••');
            }
            const fills = [...container.querySelectorAll('tbody td [aria-hidden="true"] > span')];
            for (const f of fills) expect(f.style.width).toBe('0%');
        } finally {
            globalThis.localStorage?.removeItem('xc:balancesHidden');
        }
    });

    it('formats values in whole units, cents under one unit, compact from a million', () => {
        expect(formatAllocationValue(100000)).toBe('$100,000');
        expect(formatAllocationValue(0.42)).toBe('$0.42');
        expect(formatAllocationValue(9_100_000)).toBe('$9.1M');
        expect(formatAllocationValue(1234, 'EUR')).toBe('€1,234');
    });
});

describe('AllocationCard headers line up with their columns', () => {
    it('puts Asset over the dot, ticker and bar, then Share and Value over theirs', () => {
        mount();
        const table = screen.getByRole('table');
        const heads = within(table).getAllByRole('columnheader');
        expect(heads.map((th) => th.textContent)).toEqual(['Asset', 'Share', 'Value']);
        expect(heads[0]).toHaveAttribute('colspan', '2');
        // Share and Value sit in the same table columns as their cells.
        const headCols = heads.map((th) => th.getAttribute('data-allocation-col'));
        expect(headCols).toEqual([null, 'share', 'value']);
        for (const tr of bodyRows()) {
            const cells = within(tr).getAllByRole('cell');
            expect(cells.map((td) => td.getAttribute('data-allocation-col'))).toEqual([null, 'share', 'value']);
        }
    });

    it('right-aligns the Share and Value headers exactly as their cells, in tabular digits', () => {
        // Every element carrying a numeric column marker, header or cell,
        // takes the one .num class.
        const marked = [...JSX.matchAll(/<(th|td)\b[^>]*data-allocation-col="(share|value)"[^>]*>/g)];
        expect(marked).toHaveLength(4);
        for (const [tag] of marked) expect(tag).toMatch(/className=\{(`\$\{)?styles\.num\b/);
        const num = rule(CSS, '.num');
        expect(decl(num, 'text-align')).toBe('end');
        expect(decl(num, 'font-variant-numeric')).toBe('tabular-nums');
        // Nothing gives a header or a cell an alignment of its own: the only
        // text-align rules are the asset column's start and the numbers' end.
        expect(decl(rule(CSS, '.headAsset'), 'text-align')).toBe('start');
        expect([...CSS.matchAll(/text-align:\s*([a-z]+);/g)].map((m) => m[1]).sort()).toEqual(['center', 'end', 'start', 'start']);
        expect(decl(rule(CSS, '.share'), 'text-align')).toBeNull();
        expect(decl(rule(CSS, '.value'), 'text-align')).toBeNull();
        expect(decl(rule(CSS, '.table th,\n.table td'), 'padding')).toBe('0');
    });

    it('draws a thin divider under the header row', () => {
        const head = rule(CSS, '.table thead th');
        expect(decl(head, 'border-block-end')).toMatch(/^1px solid /);
        expect(decl(head, 'text-transform')).toBe('uppercase');
        // The rows are not divided, so the line marks only the header.
        expect(CSS.match(/border-block-end/g)).toHaveLength(1);
    });
});

describe('AllocationCard hero surface', () => {
    it('uses the wallet value card surface tokens and caption size', () => {
        const card = rule(CSS, '.card');
        expect(decl(card, 'background')).toBe('var(--xc-hero-bg)');
        expect(decl(card, 'color')).toBe('var(--xc-hero-text)');
        expect(decl(card, 'border')).toBe('1px solid var(--xc-hero-border)');
        expect(decl(card, 'padding')).toBe('var(--xc-card-pad)');
        expect(decl(card, 'box-shadow')).toBe('var(--xc-hero-shadow)');
        expect(decl(rule(CSS, '.title'), 'font-size')).toBe(decl(rule(HERO_CSS, '.label.walletLabel'), 'font-size'));
    });

    it('pins the light and dark ice hero surfaces', () => {
        expect(ALLOCATION_HERO_SURFACES).toEqual(['#EEF6FC', '#10213A']);
        for (const surface of ALLOCATION_HERO_SURFACES) {
            expect(TOKENS).toContain(`--xc-hero-bg: ${surface};`);
        }
    });

    it('routes every piece of text through the AA hero foreground', () => {
        const colors = [...CSS.matchAll(/(?:^|[\s;{])color:\s*([^;]+);/g)].map((m) => m[1].trim());
        expect(colors.length).toBeGreaterThan(3);
        for (const c of colors) expect(['var(--xc-hero-text)']).toContain(c);
        expect(contrastRatio('#0F172A', '#EEF6FC')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#E5EAF2', '#10213A')).toBeGreaterThanOrEqual(4.5);
        expect(CSS).not.toMatch(/opacity\s*:/);
    });

    it('fits every slice colour to at least 3:1 on both hero surfaces', () => {
        const many = [
            ...SAMPLE.slice(0, 5),
            row('dogecoin-mainnet', 'DOGE', 'native', 1100),
            ...Array.from({ length: 9 }, (_, i) => row('bitcoin-mainnet', `T${i}`, 'token', 1000 - i)),
        ];
        const all = [
            ...allocationSlices(many, chainRegistry).slices.map((s) => s.color),
            ...['#F7931A', '#345D9D', '#C2A633', '#000000', '#1A7BAC', '#123456'].map(fitAllocationColor),
            ALLOCATION_OTHER_COLOR,
        ];
        for (const color of all) {
            expect(color).toMatch(/^#[0-9A-F]{6}$/);
            for (const surface of ALLOCATION_HERO_SURFACES) {
                expect(contrastRatio(color, surface)).toBeGreaterThanOrEqual(ALLOCATION_DOT_CONTRAST);
            }
        }
        const btc = fitAllocationColor('#F7931A');
        const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(btc.slice(i, i + 2), 16));
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
    });
});

describe('AllocationCard fits the top row', () => {
    // The card before this change: 1px border, 8px padding, a 16px title at
    // 1.3, an 8px gap and a 136px donut. The wallet value card is never
    // made taller than the row already was.
    const OLD_CARD_PX = 2 + 16 + 16 * 1.3 + 8 + 136;
    // The widest text each column holds at 13px (11px for the headers), in
    // Chromium with the app font.
    const WIDEST = { share: 50.2, value: 62.4, headShare: 37.5, headValue: 36.5, PEPECASH: 69.6, WOWDOGEM: 85.5 };
    // Card widths beside the wallet value card (grid 1.9fr / 1fr, 8px gap),
    // taken 16px narrower than Home's measured width to stay on the safe
    // side: 1,107px at a 1280 window, 1,747px at 1920.
    const cardWidth = (home) => Math.max(300, (home - 16 - 8) / 2.9);

    it('is no taller than the card it replaces', () => {
        const table = tableHeight();
        const body = Math.max(table, 120);
        const card = 2 + 16 + 20 * 1.2 + 8 + body;
        expect(table).toBeLessThanOrEqual(132);
        expect(card).toBeLessThanOrEqual(OLD_CARD_PX);
    });

    it('fits an eight-letter ticker, a bar, Share and Value without overflow at 1280', () => {
        const width = cardWidth(1107);
        expect(width).toBeGreaterThan(370);
        expect(width).toBeLessThan(380);
        const tickerMax = cardVar('--xc-allocation-ticker-max');
        const gap = cardVar('--xc-allocation-col-gap');
        const dot = cardVar('--xc-allocation-dot');
        const donut = cardVar('--xc-allocation-donut');
        const barMin = px(decl(rule(CSS, '.barCell'), '--xc-allocation-bar-min'));
        expect(tickerMax).toBeGreaterThanOrEqual(WIDEST.PEPECASH);
        expect(tickerMax).toBeGreaterThanOrEqual(WIDEST.WOWDOGEM);
        const needed = 2 + 16 + donut + 8
            + (dot + dotGap() + tickerMax)
            + (gap + barMin)
            + (gap + Math.max(WIDEST.share, WIDEST.headShare))
            + (gap + Math.max(WIDEST.value, WIDEST.headValue));
        expect(needed).toBeLessThanOrEqual(width);
        // A longer ticker ends in an ellipsis instead of pushing the columns.
        const ticker = rule(CSS, '.ticker');
        expect(decl(ticker, 'max-width')).toBe('var(--xc-allocation-ticker-max)');
        expect(decl(ticker, 'text-overflow')).toBe('ellipsis');
        expect(decl(ticker, 'overflow')).toBe('hidden');
    });

    it('fits with the larger donut and longer tickers at 1920', () => {
        const width = cardWidth(1747);
        const wide = /@container \(min-width: (\d+)px\)\s*\{\s*\.body\s*\{([^}]*)\}/.exec(CSS);
        expect(wide).not.toBeNull();
        expect(width - 18).toBeGreaterThanOrEqual(Number(wide[1]));
        const donut = px(decl(wide[2], '--xc-allocation-donut'));
        const tickerMax = px(decl(wide[2], '--xc-allocation-ticker-max'));
        const gap = cardVar('--xc-allocation-col-gap');
        const needed = 2 + 16 + donut + 8 + (cardVar('--xc-allocation-dot') + dotGap() + tickerMax) + (gap + 16)
            + (gap + WIDEST.share) + (gap + WIDEST.value);
        expect(needed).toBeLessThanOrEqual(width);
        // The larger donut still fits the height the table sets.
        expect(donut).toBeLessThanOrEqual(tableHeight());
    });

    it('never wraps a cell, so a row stays one line tall', () => {
        expect(decl(rule(CSS, '.table th,\n.table td'), 'white-space')).toBe('nowrap');
    });
});
