// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Dispenser Explorer's browse layout (operator ruling 2026-11-14): the
// Popular | Newest | Best deals toggle is the first thing under the header,
// the search box lives in the header's filter panel, the dispensers are one
// list card with a divider between rows, and every row is three lines with the
// same layout on every tab.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserExplorer } from '../../../packages/core/src/shared/routes/DispenserExplorer.jsx';

const SELLER_A = 'bc1qsellerasellerasellerasellerasellerasellera0';
const SELLER_B = 'bc1qsellerbsellerbsellerbsellerbsellerbsellerb0';
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

const ROWS = [
    {
        action_index: 'a1', source: SELLER_A, give_tick: 'PEPECASH', give_amount: '1000',
        get_coin: 'DOGE', get_tick: null, get_amount: '147', status: 'valid', current_status: 'open',
        give_escrow: '20000', escrow_remaining: '4000', timestamp: now - 4 * DAY, dispense_count: 5,
    },
    {
        action_index: 'b2', source: SELLER_B, give_tick: 'PEPECASH', give_amount: '500',
        get_coin: 'DOGE', get_tick: null, get_amount: '60', status: 'valid', current_status: 'open',
        give_escrow: '10000', escrow_remaining: '9000', timestamp: now - DAY, dispense_count: 2,
    },
];

function readCss(path) {
    return readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:>]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

function renderExplorer() {
    const messaging = {
        getSettings: async () => ({ schemaVersion: 2, activeNetwork: 'mainnet' }),
        updateSettings: async (p) => p,
        getMarkets: vi.fn().mockResolvedValue({ data: [{ tick1: 'PEPECASH', tick2: 'DOGE', depth: 9 }] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: ROWS }),
        getDispensersForAddress: vi.fn(),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DispenserExplorer onOpenDispenser={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function rows() {
    const facts = await screen.findAllByTestId('dispenser-result-facts');
    return facts.map((fact) => fact.closest('button'));
}

afterEach(() => cleanup());

describe('DispenserExplorer browse layout', () => {
    it('puts the Popular | Newest | Best deals toggle first under the header', async () => {
        renderExplorer();
        await rows();

        const browse = screen.getByRole('region', { name: 'Browse dispensers' });
        // Nothing sits between the page header and the toggle: the browse
        // section is the first child of the list page.
        expect(browse.parentElement.firstElementChild).toBe(browse);
        expect(browse.firstElementChild).toBe(screen.getByRole('tablist', { name: 'Dispenser order' }));
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Popular', 'Newest', 'Best deals']);
        // The only gap above it is the list page's own 8px; no extra margin.
        const css = readCss('packages/core/src/shared/routes/DispenserExplorer.module.css');
        expect(ruleBody(css, '.browse')).not.toMatch(/margin-top|margin-block/);
        const page = readCss('packages/core/src/ui/ListPage.module.css');
        expect(page).toMatch(/--xc-list-page-gap:\s*var\(--xc-space-2\)/);
    });

    it('keeps the search box in the filter popover, not in its own row', async () => {
        renderExplorer();
        await rows();

        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.queryByRole('form', { name: 'Dispenser search' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Filter dispensers' }));
        const popover = screen.getByRole('dialog', { name: 'Filter dispensers' });
        expect(within(popover).getByRole('searchbox')).toBeInTheDocument();
        expect(within(popover).queryByRole('form', { name: 'Dispenser search' })).toBeNull();
        expect(screen.getAllByRole('searchbox')).toHaveLength(1);
        // The Network filter shares the panel.
        expect(within(popover).getByRole('button', { name: 'Network: All networks' })).toBeInTheDocument();
    });

    it('lists the dispensers in one list card with divider lines between rows', async () => {
        renderExplorer();
        const items = await rows();

        expect(items.length).toBeGreaterThan(1);
        // Every row is a direct child of one list container: no card per item.
        const list = items[0].parentElement;
        items.forEach((item) => expect(item.parentElement).toBe(list));
        expect(list.children).toHaveLength(items.length);

        const css = readCss('packages/core/src/shared/routes/DispenserExplorer.module.css');
        expect(ruleBody(css, '.cardList')).toMatch(/composes:\s*flush from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        expect(ruleBody(css, '.cardList')).toMatch(/overflow:\s*hidden/);
        expect(css).toMatch(/\.cardList > \* \+ \*[^{]*\{[^}]*border-top:\s*1px solid var\(--xc-border\)/);

        const row = readCss('packages/core/src/shared/components/DispenserExplorerCard.module.css');
        const rowRule = ruleBody(row, '.row');
        expect(rowRule).toMatch(/border:\s*0/);
        expect(rowRule).toMatch(/border-radius:\s*0/);
        expect(rowRule).not.toMatch(/composes/);
    });

    it('gives each row exactly three lines, with no coin name and no address', async () => {
        renderExplorer();
        const items = await rows();
        const top = items.find((item) => item.getAttribute('aria-label')?.startsWith('1,000 PEPECASH'));
        expect(top, 'the 1,000 PEPECASH row').toBeTruthy();

        const facts = within(top).getByTestId('dispenser-result-facts');
        const lines = [...facts.querySelectorAll('[data-row-line]')];
        expect(facts.children).toHaveLength(3);
        expect(lines.map((line) => line.getAttribute('data-row-line'))).toEqual(['terms', 'bar', 'stock']);
        expect(lines[0].textContent).toBe('1,000 PEPECASH for 147 DOGE');
        // The progress bar is the second line, 20% full.
        expect(lines[1].firstElementChild.style.width).toBe('20%');
        expect(lines[2].textContent).toMatch(/^4,000 of 20,000 left · Opened 4 days/);

        // No address and no coin name anywhere in the row; the token icon's
        // chain badge names the network and the chevron ends the row.
        expect(top.textContent).not.toContain(SELLER_A);
        expect(top.textContent).not.toMatch(/bc1q|Bitcoin|Dogecoin|Litecoin/);
        expect(top.querySelector('[data-row-chevron]')).not.toBeNull();
        expect(top.querySelector('[role="img"]')).not.toBeNull();
        expect(top.getAttribute('aria-label')).not.toContain(SELLER_A);
    });

    it('draws identical rows on the Popular, Newest and Best deals tabs', async () => {
        renderExplorer();
        await rows();

        const signature = async (name) => {
            fireEvent.click(screen.getByRole('tab', { name }));
            const items = await rows();
            return items.map((item) => item.outerHTML).sort();
        };
        const popular = await signature(/Popular/);
        const newest = await signature(/Newest/);
        const deals = await signature(/Best deals/);

        expect(popular.length).toBeGreaterThan(1);
        expect(newest).toEqual(popular);
        expect(deals).toEqual(popular);
        // One list, whichever tab is open.
        expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
        await waitFor(() => expect(screen.getAllByTestId('dispenser-result-facts').length).toBe(popular.length));
    });

    // U02: the tabs and the list card fill the page content width at every
    // width, as on the other list pages, rather than a centred column.
    it('lets the tabs and the list card fill the content width', () => {
        const css = readCss('packages/core/src/shared/routes/DispenserExplorer.module.css');
        for (const selector of ['.browse', '.resultGroup']) {
            expect(ruleBody(css, selector), selector).not.toMatch(/max-width|margin-inline/);
        }
        expect(css).not.toMatch(/max-width:\s*760px/);
    });
});
