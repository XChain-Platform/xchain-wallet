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

function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
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
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: token } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
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
        expect(screen.getAllByText('open')).not.toHaveLength(0);
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
        expect(screen.getAllByTestId('dispenser-result-facts').some(
            (facts) => facts.closest('button')?.textContent?.includes('#open'),
        )).toBe(true);
        expect(screen.getAllByText('open')).not.toHaveLength(0);
        expect(screen.queryByText(/#closed/)).toBeNull();
        expect(screen.queryByText(/#empty/)).toBeNull();
    });

    it.each([320, 360])('renders separate give, price, and status rows at %ipx', async (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        renderExplorer({
            oracleFeeds: vi.fn().mockResolvedValue([{
                tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' },
            }]),
        });
        await searchFor('MGRTEST');

        const [facts] = await screen.findAllByTestId('dispenser-result-facts');
        expect(facts).toHaveAttribute('role', 'list');
        expect(within(facts).getByText('Give per fill')).toBeInTheDocument();
        expect(within(facts).getByText('1 MGRTEST')).toBeInTheDocument();
        expect(within(facts).getByText('Price per fill')).toBeInTheDocument();
        expect(within(facts).getByText(/0\.05 USD/)).toBeInTheDocument();
        expect(within(facts).getByText('Status')).toBeInTheDocument();
        expect(within(facts).getByText('open')).toBeInTheDocument();
        expect(facts.closest('button')?.className).toMatch(/resultRow/);
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
        expect(ruleBody(detailNarrow, '.buyFillsRow')).toMatch(/flex-direction:\s*column/);
        expect(ruleBody(detailNarrow, '.dispenseRow')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);

        const explorer = readCss('packages/core/src/shared/routes/DispenserExplorer.module.css');
        expect(ruleBody(explorer, '.resultRow')).toMatch(/flex-direction:\s*column/);
        expect(ruleBody(explorer, '.factValue')).toMatch(/overflow-wrap:\s*anywhere/);

        const form = readCss('packages/core/src/shared/routes/IssueTokenForm.module.css');
        expect(ruleBody(form, '.picker')).toMatch(/max-width:\s*100%/);
        expect(ruleBody(form, '.actions')).toMatch(/flex-wrap:\s*wrap/);
    });
});
