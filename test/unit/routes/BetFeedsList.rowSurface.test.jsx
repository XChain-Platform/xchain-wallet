// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Prediction markets and governance render the same framed question list and
// the same question row. Their adapters retain money and vote wording.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';

const CHAIN = 'bitcoin-mainnet';

afterEach(() => cleanup());

describe('BetFeedsList market rows', () => {
    it('renders each market as a list row, not the filled shared Button', async () => {
        render(
            <MessagingProvider
                shell="web"
                messaging={{
                    getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: 'bc1qexampleexampleexampleexampleexampleex' }] }),
                    betFeeds: vi.fn().mockResolvedValue({
                        data: [
                            { action_index: 7, tick: 'XCHAIN', label: 'Will the proposal pass?', outcomes: 'Yes,No', feed_status: 'open' },
                            { action_index: 8, tick: 'XCHAIN', label: 'Second market', outcomes: 'Yes,No', feed_status: 'open' },
                        ],
                    }),
                }}
            >
                <BetFeedsList walletId="wallet-1" onOpenMarket={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        const rows = await Promise.all(['Will the proposal pass?', 'Second market']
            .map(async (text) => (await screen.findByText(text)).closest('button')));
        for (const row of rows) {
            expect(row).toBeTruthy();
            expect(row.hasAttribute('aria-busy')).toBe(false);
            expect(row.getAttribute('type')).toBe('button');
        }
    });

    it('renders markets through the shared framed question list', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/routes/BetFeedsList.jsx'), 'utf8');
        const cardSource = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/components/BetMarketCard.jsx'), 'utf8');
        const sharedCss = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/components/QuestionList.module.css'), 'utf8');
        expect(source.length).toBeGreaterThan(1000);
        expect(source).toMatch(/<BetMarketCard\s+market=\{m\}/);
        expect(source).toContain('<QuestionList label="Prediction markets"');
        expect(source).toMatch(/if \(!twoPanel\) \{\s*onOpenMarket\(chainId, m\.action_index\);/);
        expect(source.match(/<BetMarketCard\b/g)).toHaveLength(1);
        expect(cardSource).toContain('<QuestionListRow');
        expect(sharedCss).toMatch(/\.panel\s*\{[^}]*composes:\s*flush/s);
        expect(sharedCss).toMatch(/\.row\[aria-current='true'\]/);
    });

    it('lets the phone tab underline span the full toolbar row', () => {
        const css = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/routes/BetFeedsList.module.css'), 'utf8');

        // The tabs fill the toolbar row at every width, so no phone-only override is needed.
        expect(css).toMatch(/\.toolbarRow \{[^}]*display: flex;[^}]*width: 100%;[^}]*\}/);
        expect(css).toMatch(/\.toolbarActions > \* \{[^}]*flex: 1 1 auto;[^}]*width: 100%;[^}]*\}/);
    });
});
