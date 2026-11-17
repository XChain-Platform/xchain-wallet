// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';

const STYLES = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/TotalBalanceHero.module.css',
), 'utf8');

function row(overrides = {}) {
    return {
        kind: 'token',
        chainId: 'bitcoin-mainnet',
        tick: 'XCP',
        quantity: '123456',
        divisibility: 2,
        fiatRate: 1,
        ...overrides,
    };
}

function mount({ rows = [row()], settings = {}, nativePrices = {}, ...props } = {}) {
    const messaging = {
        getSettings: vi.fn(async () => settings),
        getNativePricesRequest: vi.fn(async () => ({ prices: nativePrices })),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TotalBalanceHero
                rows={rows}
                walletId="w1"
                networkFilter="all"
                {...props}
            />
        </MessagingProvider>,
    );
    return { ...view, messaging };
}

function cssRule(selector) {
    return STYLES.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
});

describe('TotalBalanceHero privacy', () => {
    it('masks the total and removes every numeric summary figure', () => {
        window.localStorage.setItem('xc:balancesHidden', '1');
        mount({
            rows: [row(), row({ tick: 'NOQUOTE', fiatRate: null })],
            lastSyncedAt: Date.now() - 60_000,
        });

        expect(screen.getByText('•••••')).toBeInTheDocument();
        // The amount and the summary row's change pill are both masked, and the
        // summary row stays so hiding the balance never changes the card's height.
        expect(screen.getAllByLabelText('Balance hidden')).toHaveLength(2);
        expect(screen.queryByText('$1,234.56')).toBeNull();
        expect(screen.queryByText(/not priced/)).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByLabelText('Balance summary').textContent).not.toMatch(/\d/);
    });
});

describe('TotalBalanceHero fiat formatting', () => {
    it('uses the shared tiny-positive floor for the headline total', async () => {
        mount({ rows: [row({ quantity: '5', divisibility: 3 })] });

        expect(await screen.findByText('< $0.01')).toBeInTheDocument();
    });

    it('sums every priced row exactly and excludes an unpriced holding', () => {
        mount({
            rows: [
                row(),
                row({ tick: 'SECOND', quantity: '44', divisibility: 0, fiatRate: 0.5 }),
                row({ tick: 'UNPRICED', quantity: '999', divisibility: 0, fiatRate: null }),
            ],
        });

        expect(screen.getByText('$1,256.56')).toBeInTheDocument();
        expect(screen.queryByText(/not priced/)).toBeNull();
        expect(screen.getByLabelText('1,256.56 US dollars')).toBeInTheDocument();
    });

    it('shows a numeric zero when every holding lacks a price', () => {
        mount({
            rows: [row({ quantity: '50000000', divisibility: 8, fiatRate: null })],
        });

        expect(screen.getByText('$0.00')).toBeInTheDocument();
        expect(screen.getByLabelText('0.00 US dollars')).toBeInTheDocument();
    });

    it('uses locale currency placement and keeps the ISO code as the suffix', async () => {
        mount({ settings: { fiatCurrency: 'EUR', language: 'de-DE' } });

        expect(await screen.findByText(/1\.234,56\s€/)).toBeInTheDocument();
        expect(screen.getByText('EUR')).toBeInTheDocument();
        expect(screen.getByLabelText(/1\.234,56 Euro/)).toBeInTheDocument();
    });

    it('does not repeat a currency code when Intl exposes it as the symbol', async () => {
        mount({ settings: { fiatCurrency: 'CHF', language: 'en-US' } });

        await screen.findByText('1,234.56');
        const text = screen.getByRole('region', { name: 'Active address balance' }).textContent;
        expect(text.match(/CHF/g)).toHaveLength(1);
    });

    it('retains a code-like symbol on a change figure without an ISO suffix', async () => {
        mount({
            rows: [row({ kind: 'native' })],
            settings: { fiatCurrency: 'CHF', language: 'en-US' },
            nativePrices: { 'bitcoin-mainnet': { change24hPct: 10 } },
        });

        const change = await screen.findByText(/CHF\s*112\.23 \(\+10\.00%\) · 24h/);
        expect(change).toBeInTheDocument();
        expect(change).toHaveAccessibleName(/24-hour change\. Increase: \+10\.00%/);
    });

    it('keeps every digit of a total beyond Number safe-integer range', () => {
        mount({
            rows: [row({ quantity: '12345678901234567890123456789012' })],
        });

        expect(screen.getByText('$123,456,789,012,345,678,901,234,567,890.12'))
            .toBeInTheDocument();
    });

    it('requests change data in the selected fiat currency', async () => {
        const { messaging } = mount({
            rows: [row({ kind: 'native' })],
            settings: { fiatCurrency: 'EUR' },
        });

        await screen.findByText('EUR');
        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: ['bitcoin-mainnet'],
            fiatCurrency: 'EUR',
        });
    });
});

describe('TotalBalanceHero message formatting', () => {
    it('renders the test-coin message in secondary body text', () => {
        mount({ rows: [row({ chainId: 'bitcoin-testnet', fiatRate: null })] });

        const amount = screen.getByText('Test coins have no value').closest('[aria-label]');
        expect(amount.className).toMatch(/amountMessage/);
        expect(cssRule('amountMessage')).toMatch(/font-family:\s*var\(--xc-font-sans\)/);
        expect(cssRule('amountMessage')).toMatch(/font-size:\s*var\(--xc-text-lg\)/);
    });

    it('keeps numeric totals in the headline amount style', () => {
        mount();

        expect(screen.getByText('$1,234.56').closest('[aria-label]').className)
            .not.toMatch(/amountMessage/);
        expect(cssRule('amount')).toMatch(/font-size:\s*32px/);
    });
});

describe('TotalBalanceHero refresh status', () => {
    it('does not render an updated line while online', () => {
        mount({ lastSyncedAt: Date.now() });

        expect(screen.queryByText(/^Updated/)).toBeNull();
    });

    it('does not render an updated line while offline either; Settings, About shows it', () => {
        // The last-updated time moved off the card to Settings, About, so
        // saved balances shown offline carry no age line on the card.
        const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        try {
            mount({ lastSyncedAt: Date.now() - 2 * 24 * 60 * 60_000 });
            expect(screen.queryByText(/Updated/)).toBeNull();
            expect(screen.queryByText(/ago/)).toBeNull();
        } finally {
            onLine.mockRestore();
        }
    });

    it('leaves refresh out of the balance card and prints no online freshness line', () => {
        // The card has two buttons, Show in BTC and the eye; Refresh is not
        // among them, and a menu appears only where it holds other rows.
        const onRefresh = vi.fn();
        const lastSyncedAt = Date.now() - 2 * 60_000;
        const pricesFetchedAt = Date.now() - 10 * 60_000;
        const { rerender } = mount({ lastSyncedAt, pricesFetchedAt, onRefresh });

        expect(screen.queryByText(/^Updated/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Balance actions' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Refresh portfolio/ })).toBeNull();
        expect(onRefresh).not.toHaveBeenCalled();

        rerender(
            <MessagingProvider shell="web" messaging={{ getSettings: vi.fn(async () => ({})) }}>
                <TotalBalanceHero
                    rows={[row()]}
                    walletId="w1"
                    networkFilter="all"
                    pricesFetchedAt={pricesFetchedAt}
                    onRefresh={onRefresh}
                    refreshing
                />
            </MessagingProvider>,
        );
        expect(screen.queryByRole('button', { name: 'Balance actions' })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: /Refreshing portfolio/ })).toBeNull();
    });
});

describe('TotalBalanceHero responsive layout', () => {
    it('keeps the Home total ahead of its actions in DOM reading order', () => {
        mount();

        const label = screen.getByText('Active address balance');
        const region = screen.getByRole('region', { name: 'Active address balance' });
        const total = screen.getByText('$1,234.56');
        const action = screen.getByRole('button', { name: 'Hide balance' });

        expect(region).toHaveAttribute('aria-labelledby', label.id);
        expect(region).not.toHaveAttribute('aria-label');
        expect(label.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(total.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('wraps summary facts and contains oversized total text', () => {
        expect(cssRule('meta')).toMatch(/flex-wrap:\s*wrap/);
        expect(cssRule('metaLeft')).toMatch(/flex-wrap:\s*wrap/);
        expect(cssRule('amount')).toMatch(/flex-wrap:\s*wrap/);
        expect(cssRule('amountValue')).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('puts the unit swap and the eye in the card and the shell rows in one overflow menu', () => {
        const onOpenSettings = vi.fn();
        const onCommandPalette = vi.fn();
        const onLockWallet = vi.fn();
        mount({ onOpenSettings, onCommandPalette, onLockWallet });

        const swap = screen.getByRole('button', { name: 'Show in BTC' });
        const eye = screen.getByRole('button', { name: 'Hide balance' });
        const trigger = screen.getByRole('button', { name: 'Balance actions' });
        expect(screen.getAllByRole('button')).toEqual([swap, eye, trigger]);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(trigger);
        const menu = screen.getByRole('menu', { name: 'Balance actions' });
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Open settings',
            'Open the wallet menu',
            'Lock wallet',
        ]);
        expect(within(menu).queryAllByRole('menuitemcheckbox')).toHaveLength(0);
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open settings' }));
        expect(onOpenSettings).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu', { name: 'Balance actions' })).toBeNull();
        expect(STYLES).toMatch(/@media not all and \(min-width: 480px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--xc-control-h-sm\)/);
    });
});

describe('TotalBalanceHero card surface', () => {
    it('paints the card flat app blue with no gradient, on the hero and on Home\'s card stack', () => {
        const homeStyles = readFileSync(join(
            process.cwd(),
            'packages/core/src/shared/components/HomeTabs.module.css',
        ), 'utf8');
        const heroStack = homeStyles.match(/\.heroStack\s*\{([^}]*)\}/)?.[1] || '';

        expect(cssRule('hero')).toMatch(/background:\s*var\(--xc-accent-primary\);/);
        expect(heroStack).toMatch(/background:\s*var\(--xc-accent-primary\);/);
        expect(STYLES).not.toMatch(/-gradient\(/);
        expect(heroStack).not.toMatch(/-gradient\(/);
    });
});
