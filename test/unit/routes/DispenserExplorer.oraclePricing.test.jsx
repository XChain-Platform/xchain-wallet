// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The buyer-side dispenser search quoted an oracle-priced (Mode B) dispenser
// as "1 MGRTEST per 0 DOGE", printing the create row's GET_AMOUNT 0 as its
// price. Rows are shaped as the explorer's token lane serves them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';

const ORACLE = 'ndDEAAsomeoracleaddresssomeoracleaddress01';
const MODE_B_ROW = {
    action_index: '2868', source: 'nqdPCKownerownerownerownerownerowner01',
    give_tick: 'MGRTEST', give_amount: '1', get_coin: 'DOGE', get_tick: null, get_amount: '0',
    oracle_address: ORACLE, status: 'valid', current_status: 'open', escrow_remaining: '48',
};
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function readCss(path) {
    return readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

// Every block for one media query, joined: a stylesheet may hold the same
// query more than once.
function mediaBlock(text, query) {
    const blocks = [];
    let start = text.indexOf(`@media ${query}`);
    while (start >= 0) {
        const open = text.indexOf('{', start);
        let depth = 0;
        let end = text.length;
        for (let index = open; index < text.length; index += 1) {
            if (text[index] === '{') depth += 1;
            if (text[index] === '}') depth -= 1;
            if (depth === 0) { end = index; break; }
        }
        blocks.push(text.slice(open + 1, end));
        start = text.indexOf(`@media ${query}`, end);
    }
    return blocks.join('\n');
}

function renderExplorer(extra = {}) {
    const messaging = {
        getSettings: async () => ({ schemaVersion: 2, activeNetwork: 'regtest' }),
        updateSettings: async (p) => p,
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [MODE_B_ROW] }),
        getDispensersForAddress: vi.fn(),
        ...extra,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function searchFor(token) {
    // The search box lives in the title bar's filter panel; Popular, Newest and
    // Best deals list on the page until something is typed.
    fireEvent.click(screen.getByRole('button', { name: 'Filter dispensers' }));
    await waitFor(() => expect(screen.queryByText('Loading available networks…')).toBeNull());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: token } });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
}

afterEach(() => {
    cleanup();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

describe('DispenserExplorer result price for an oracle-priced dispenser', () => {
    it('quotes the oracle fill price, not zero coin', async () => {
        const messaging = renderExplorer({
            oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' } }]),
        });
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/0\.05 USD \(oracle ndDEAA/))
            .not.toHaveLength(0);
        // A result card lists open dispensers only, so it prints no status word
        // (and never the raw indexer status).
        expect(screen.queryAllByText('valid')).toHaveLength(0);
        expect(document.body.textContent).not.toMatch(/per 0 DOGE/);
        expect(messaging.oracleFeeds).toHaveBeenCalledWith(expect.objectContaining({ address: ORACLE }));
    });

    it('says so when the oracle has no current price', async () => {
        renderExplorer({
            oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'MGRTEST', fiat: 'USD', live: null }]),
        });
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/no current price, stale/)).not.toHaveLength(0);
    });

    it('shows the explorer stale-price state instead of advertising a rate', async () => {
        renderExplorer({
            getDispensersForToken: vi.fn().mockResolvedValue({
                data: [{ ...MODE_B_ROW, price_stale: true }],
            }),
            oracleFeeds: vi.fn().mockResolvedValue([{
                tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' },
            }]),
        });
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/Not selling right now: no price in the last 24 hours/))
            .not.toHaveLength(0);
        expect(screen.queryAllByText(/0\.05 USD/)).toHaveLength(0);
    });

    it('never quotes zero coin on a host that cannot read oracle feeds', async () => {
        renderExplorer();
        await searchFor('MGRTEST');
        expect(await screen.findAllByText(/open the dispenser for the price/)).not.toHaveLength(0);
        expect(document.body.textContent).not.toMatch(/per 0 DOGE/);
    });

    it('omits closed and empty rows while keeping open per-fill terms explicit', async () => {
        renderExplorer({
            getDispensersForToken: vi.fn().mockResolvedValue({
                data: [
                    { ...MODE_B_ROW, action_index: 'open' },
                    { ...MODE_B_ROW, action_index: 'closed', current_status: 'cancelled' },
                    { ...MODE_B_ROW, action_index: 'empty', escrow_remaining: '0' },
                ],
            }),
            oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' } }]),
        });
        await searchFor('MGRTEST');

        expect(await screen.findAllByText(/0\.05 USD/))
            .not.toHaveLength(0);
        // Of the three rows a chain returns, only the open one gets a card, so
        // each group (one per searched chain) holds exactly one card.
        const cards = screen.getAllByTestId('dispenser-result-facts');
        const groups = new Set(cards.map((facts) => facts.closest('[id^="dispenser-token-"]')));
        expect(groups.size).toBe(cards.length);
        cards.forEach((facts) => {
            expect(facts.closest('button')?.getAttribute('aria-label')).toMatch(/^1 MGRTEST for 0\.05 USD/);
        });
    });

    it.each([320, 360])('renders the give, price and chain lines of a result card at %ipx', async (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        renderExplorer({
            oracleFeeds: vi.fn().mockResolvedValue([{
                tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' },
            }]),
        });
        await searchFor('MGRTEST');

        const [facts] = await screen.findAllByTestId('dispenser-result-facts');
        expect(facts).toHaveAttribute('role', 'list');
        // One row: the give and the price share the first line, the stock
        // left sits on the line under it; no coin name and no address.
        expect(within(facts).getByText('1 MGRTEST')).toBeInTheDocument();
        expect(within(facts).getByText(/0\.05 USD/)).toBeInTheDocument();
        expect(within(facts).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
        expect(facts.closest('button')?.className).toMatch(/row/);
    });

    it('pins the no-overflow rules shared by all four dispenser screens', () => {
        const listNarrow = mediaBlock(readCss(
            'packages/core/src/shared/routes/DispensersList.module.css',
        ), 'not all and (min-width: 400px)');
        expect(ruleBody(listNarrow, '.row')).toMatch(/grid-template-columns:\s*40px minmax\(0, 1fr\)/);
        expect(ruleBody(listNarrow, '.status')).toMatch(/overflow-wrap:\s*anywhere/);


        const detailNarrow = mediaBlock(readCss(
            'packages/core/src/shared/routes/DispenserDetail.module.css',
        ), 'not all and (min-width: 400px)');
        // Dispense rows are ListRows: the amount wraps inside the shrinkable
        // content column and the time column wraps on a phone instead of
        // pushing the row wider than the screen.
        const detail = readCss('packages/core/src/shared/routes/DispenserDetail.module.css');
        expect(ruleBody(detail, '.dispenseAmount')).toMatch(/min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere/);
        expect(ruleBody(detailNarrow, '.dispenseWhen')).toMatch(/white-space:\s*normal/);
        const listRow = readCss('packages/core/src/ui/ListRow.module.css');
        expect(ruleBody(listRow, '.content')).toMatch(/min-width:\s*0/);
        expect(ruleBody(listRow, '.trailing')).toMatch(/min-width:\s*0;[\s\S]*max-width:\s*50%/);

        // A result row stacks its lines in a shrinkable column and wraps long text.
        const card = readCss('packages/core/src/shared/components/DispenserExplorerCard.module.css');
        expect(ruleBody(card, '.row')).toMatch(/min-width:\s*0/);
        expect(ruleBody(card, '.body')).toMatch(/flex-direction:\s*column/);
        expect(ruleBody(card, '.body')).toMatch(/min-width:\s*0/);
        expect(ruleBody(card, '.title')).toMatch(/overflow-wrap:\s*anywhere/);

        const form = readCss('packages/core/src/shared/routes/IssueTokenForm.module.css');
        expect(ruleBody(form, '.picker')).toMatch(/max-width:\s*100%/);
        expect(ruleBody(form, '.actions')).toMatch(/flex-wrap:\s*wrap/);
    });
});
