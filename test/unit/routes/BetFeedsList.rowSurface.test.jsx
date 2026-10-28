// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A market row is the shared ListRow, as Governance poll rows are. Rendered
// through the shared Button, the row took Button's primary fill: every market
// card was accent blue with the label and outcomes in muted grey on it, about
// 1.5:1, so the market a user was about to open could not be read. Vitest
// blanks CSS modules, so the row is told apart by the aria-busy attribute the
// shared Button always sets and ListRow never does.

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

    it('keeps each market row on the card surface the poll rows use', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/routes/BetFeedsList.jsx'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/routes/BetFeedsList.module.css'), 'utf8');
        expect(source.length).toBeGreaterThan(1000);
        expect(source).toMatch(/<ListRow\s+type="button"\s+onClick=\{\(\) => onOpenMarket\(chainId, id\)\}\s+className=\{local\.marketCard\}/);
        expect(css).toMatch(/\.marketCard \{[^}]*composes: card from '\.\.\/\.\.\/ui\/Card\.module\.css';/s);
    });
});
