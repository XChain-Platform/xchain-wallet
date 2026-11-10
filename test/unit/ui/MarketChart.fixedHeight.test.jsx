// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Home portfolio chart card keeps one height whatever its price history
// says: the drawn chart, the loading line, the failure line and the
// no-history line all sit in the same fixed-height slot, and the change row
// above it keeps its line even when there is no change to print. jsdom has
// no layout, so the structure is asserted here and the declared heights are
// read from the stylesheet and checked against the Sparkline height.

import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import styles from '../../../packages/core/src/shared/components/PortfolioChart.module.css';

const CSS_PATH = 'packages/core/src/shared/components/PortfolioChart.module.css';
const JSX_PATH = 'packages/core/src/shared/components/PortfolioChart.jsx';

// 0.5 BTC at $80,000: a valued row, so the card renders.
const ROWS = [{ kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80000 }];
const SPARKLINE = Array.from({ length: 168 }, (_, i) => 70000 + i * 50);

function mount(props) {
    const messaging = {
        getSettings: vi.fn(async () => ({})),
        getNativePricesRequest: vi.fn(async () => ({})),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PortfolioChart rows={ROWS} walletId="real-wallet-1" {...props} />
        </MessagingProvider>,
    );
}

function ruleBody(css, selector) {
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(uncommented);
    return match ? match[1] : '';
}

function declared(body, property) {
    const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`, 'm').exec(body);
    return match ? match[1].trim() : null;
}

function slotOf(panel) {
    const slots = panel.querySelectorAll(`.${styles.slot}`);
    expect(slots).toHaveLength(1);
    return slots[0];
}

function changeRowOf(panel) {
    const rows = panel.querySelectorAll(`.${styles.change}`);
    expect(rows).toHaveLength(1);
    return rows[0];
}

afterEach(() => {
    cleanup();
});

describe('PortfolioChart fixed-height slot', () => {
    it('draws recorded history inside the fixed-height slot', async () => {
        mount({ nativePriceMap: { 'bitcoin-mainnet': { sparkline: SPARKLINE } } });
        await waitFor(() => expect(document.querySelector('svg polyline')).not.toBeNull());
        const panel = screen.getByRole('tabpanel');
        const slot = slotOf(panel);
        expect(slot).toContainElement(screen.getByRole('img'));
        expect(changeRowOf(panel)).toHaveTextContent('· 1W');
    });

    it('keeps the no-history line in the same slot and keeps the change row', async () => {
        mount({ nativePriceMap: {} });
        const message = await screen.findByText(/No price history/);
        const panel = screen.getByRole('tabpanel');
        expect(slotOf(panel)).toContainElement(message);
        expect(changeRowOf(panel)).toHaveTextContent('');
    });

    it('keeps the loading line in the same slot and keeps the change row', () => {
        mount({ nativePriceMap: {}, nativePricesLoading: true });
        const panel = screen.getByRole('tabpanel');
        expect(slotOf(panel)).toContainElement(screen.getByRole('status'));
        changeRowOf(panel);
    });

    it('keeps the failure line in the same slot and keeps the change row', () => {
        mount({ nativePriceMap: {}, nativePricesError: 'Price history is unavailable.' });
        const panel = screen.getByRole('tabpanel');
        expect(slotOf(panel)).toContainElement(screen.getByRole('alert'));
        changeRowOf(panel);
    });

    it('declares the slot, chart and placeholder heights equal to the Sparkline height', () => {
        const css = readFileSync(CSS_PATH, 'utf8');
        const jsx = readFileSync(JSX_PATH, 'utf8');
        const sparklineHeight = /<Sparkline[\s\S]*?height=\{(\d+)\}/.exec(jsx)?.[1];
        expect(sparklineHeight).toBe('40');
        const px = `${sparklineHeight}px`;

        expect(declared(ruleBody(css, '.slot'), 'min-block-size')).toBe(px);
        expect(declared(ruleBody(css, '.chart'), 'block-size')).toBe(px);
        expect(declared(ruleBody(css, '.placeholder'), 'min-block-size')).toBe(px);
        // The no-history line sits centred in the slot, not padded above it.
        expect(declared(ruleBody(css, '.placeholder'), 'padding')).toBeNull();
        // The change row keeps its one line when there is no change to print.
        expect(declared(ruleBody(css, '.change'), 'min-block-size'))
            .toBe('calc(1.2 * var(--xc-text-sm))');
    });
});
