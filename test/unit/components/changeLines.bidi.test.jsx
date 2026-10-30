// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A signed percent and a fiat delta keep their left-to-right order on a
// right-to-left page. Left to the page direction, "-13.38%" prints as
// "13.38%-" and the reader loses which way the balance moved.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';

const HERO_STYLES = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/TotalBalanceHero.module.css',
), 'utf8');

const ROWS = [{ kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80000 }];

afterEach(cleanup);

describe('change lines under a right-to-left page', () => {
    it('isolates the hero change line as left-to-right text', () => {
        for (const name of ['changePositive', 'changeNegative', 'changeNeutral']) {
            expect(HERO_STYLES, name).toMatch(new RegExp(`\\.${name}[,\\s{]`));
        }
        const block = HERO_STYLES.match(/\.changePositive,\s*\.changeNegative,\s*\.changeNeutral\s*\{([^}]*)\}/)?.[1] || '';
        expect(block).toMatch(/direction:\s*ltr/);
        expect(block).toMatch(/unicode-bidi:\s*isolate/);
    });

    it('wraps the chart change line in a left-to-right isolate', async () => {
        const sparkline = Array.from({ length: 168 }, (_, index) => 100 - index / 10);
        const messaging = {
            getSettings: vi.fn(async () => ({})),
            getNativePricesRequest: vi.fn(async () => ({ prices: { 'bitcoin-mainnet': { sparkline } } })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PortfolioChart rows={ROWS} walletId="real-wallet-1" />
            </MessagingProvider>,
        );

        const line = await screen.findByLabelText(/7d change\. Decrease/);
        const isolate = line.querySelector('bdi[dir="ltr"]');
        expect(isolate).not.toBeNull();
        expect(isolate.textContent).toMatch(/-\d+\.\d\d%\) · 7d$/);
    });
});
