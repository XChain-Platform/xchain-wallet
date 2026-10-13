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
import { cleanup, render, screen } from '@testing-library/react';
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
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TotalBalanceHero
                rows={rows}
                walletId="w1"
                networkFilter="all"
                {...props}
            />
        </MessagingProvider>,
    );
}

function cssRule(selector) {
    return STYLES.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('TotalBalanceHero privacy', () => {
    it('masks the total and removes every numeric summary figure', () => {
        window.localStorage.setItem('xc:balancesHidden', '1');
        mount({
            rows: [row(), row({ tick: 'NOQUOTE', fiatRate: null })],
            lastSyncedAt: Date.now() - 60_000,
        });

        expect(screen.getByText('•••••')).toBeInTheDocument();
        expect(screen.queryByText('$1,234.56')).toBeNull();
        expect(screen.queryByText(/not priced/)).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByLabelText('Balance summary')).toBeNull();
    });
});

describe('TotalBalanceHero fiat formatting', () => {
    it('uses locale currency placement and keeps the ISO code as the suffix', async () => {
        mount({ settings: { fiatCurrency: 'EUR', language: 'de-DE' } });

        expect(await screen.findByText(/1\.234,56\s€/)).toBeInTheDocument();
        expect(screen.getByText('EUR')).toBeInTheDocument();
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

        expect(await screen.findByText(/CHF\s*112\.23 \(\+10\.00%\)/)).toBeInTheDocument();
    });

    it('keeps every digit of a total beyond Number safe-integer range', () => {
        mount({
            rows: [row({ quantity: '12345678901234567890123456789012' })],
        });

        expect(screen.getByText('$123,456,789,012,345,678,901,234,567,890.12'))
            .toBeInTheDocument();
    });
});

describe('TotalBalanceHero responsive layout', () => {
    it('wraps summary facts and contains oversized total text', () => {
        expect(cssRule('meta')).toMatch(/flex-wrap:\s*wrap/);
        expect(cssRule('metaLeft')).toMatch(/flex-wrap:\s*wrap/);
        expect(cssRule('amount')).toMatch(/flex-wrap:\s*wrap/);
        expect(cssRule('amountValue')).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
