// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Bet Markets walk 2026-11-13 (wall screens 94 and 171): My markets looks
// exactly like All, the same card list and nothing else; the card holds only
// the question, the odds and the pool line; and the cards sit side by side
// on a wide screen in an auto-fill grid.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { BetMarketCard } from '../../../packages/core/src/shared/components/BetMarketCard.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const now = () => Math.floor(Date.now() / 1000);

afterEach(() => cleanup());

function market(index, status, extra = {}) {
    return {
        action_index: String(index),
        source: OWN,
        label: `Will market ${index} settle?`,
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        feed_status: status,
        deadline: now() - 60,
        expire_at: now() + 86400,
        pools: [{ outcome: 0, pool: '10' }, { outcome: 1, pool: '5' }],
        ...extra,
    };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openMyMarkets(onOpenMarket = vi.fn()) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: OWN }] }),
        betFeeds: vi.fn().mockResolvedValue({ data: [market(7, 'open'), market(8, 'closed')] }),
        bets: vi.fn().mockResolvedValue({ data: [] }),
    };
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedsList walletId="w" view="markets" onOpenMarket={onOpenMarket} onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    await screen.findByRole('button', { name: 'Will market 7 settle?' });
    return utils;
}

describe('My markets is the All card list and nothing else', () => {
    it('draws only the market cards: no count line, refresh, action card or record footer', async () => {
        const utils = await openMyMarkets();
        const text = utils.container.textContent;

        expect(text).not.toMatch(/results? to post|No results waiting on you/);
        expect(utils.queryByTestId('oracle-pending-results')).toBeNull();
        expect(screen.queryByRole('button', { name: /Refresh Markets/ })).toBeNull();
        for (const name of ['Post Result', 'Cancel and Refund', 'Copy to a New Market', 'Edit Lists', 'Resolve']) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
        expect(text).not.toMatch(/Waiting for your result/);
        expect(text).not.toMatch(/Your record as an oracle is public/);

        // Bet markets is one list: My markets is the All list filtered to this
        // wallet's markets, under the same Status filter (open by default), so
        // the settled market waits behind Status.
        const list = screen.getByRole('list', { name: 'Bet markets' });
        expect(list.querySelectorAll(':scope > li')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Will market 8 settle?' })).toBeNull();
        // The same grid class as All.
        const allCss = readFileSync('packages/core/src/shared/routes/BetFeedsList.module.css', 'utf8');
        expect(allCss).toMatch(/\.marketList\s*\{/);
    });

    it('opens a market from its card, as All does', async () => {
        const onOpenMarket = vi.fn();
        await openMyMarkets(onOpenMarket);
        fireEvent.click(screen.getByRole('button', { name: 'Will market 7 settle?' }));
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, '7');
    });
});

describe('BetMarketCard', () => {
    it('shows no market number, ticker caption, status pill, clock or icon tile', () => {
        render(<BetMarketCard market={market(700124, 'open', { deadline: now() + 86400 * 3 })} onOpen={() => {}} yours />);
        const card = screen.getByRole('button', { name: 'Will market 700124 settle?' });
        const text = card.textContent;

        expect(text).not.toContain('#700124');
        expect(text).not.toMatch(/Taking bets|Betting closed|Closes in|Closed .* ago/);
        // The ticker appears only in the pool figure.
        expect(text.match(/XCHAIN/g)).toHaveLength(1);
        expect(text).toMatch(/15 XCHAIN\s*pool/);
        expect(text).toContain('Your market');
        // One donut plus the pool coin and the chevron: no dollar tile.
        const source = readFileSync('packages/core/src/shared/components/BetMarketCard.jsx', 'utf8');
        expect(source).not.toMatch(/DollarIcon|betStatusLabel|betWhenText|styles\.status|styles\.ref\b/);
    });

    it('is one button named by the question, its odds and pool line the description', () => {
        render(<BetMarketCard market={market(9, 'open')} onOpen={() => {}} yourBet="You bet 15 XCHAIN on No" />);
        const card = screen.getByRole('button', { name: 'Will market 9 settle?' });
        const described = document.getElementById(card.getAttribute('aria-describedby'));
        expect(described.textContent).toContain('pool');
        expect(described.textContent).toContain('You bet 15 XCHAIN on No');
        expect(card.querySelectorAll('button')).toHaveLength(0);
    });

    it('is compact: 8px insets and gaps and a smaller donut', () => {
        const css = readFileSync('packages/core/src/shared/components/BetMarketCard.module.css', 'utf8');
        const rule = (name) => css.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`))?.[0] ?? '';
        expect(rule('card')).toMatch(/padding:\s*var\(--xc-space-2\)/);
        expect(rule('card')).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule('gauge')).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule('donut')).toMatch(/width:\s*64px/);
        expect(css).not.toMatch(/\.(top|tile|topText|ref|when|status)\s*\{/);
    });
});
