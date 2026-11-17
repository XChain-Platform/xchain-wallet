// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// My dispensers: filter options keep distinct icons, while each row puts its
// status on line one and stock on line two without cutting words.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';

const ROUTES = join(process.cwd(), 'packages/core/src/shared/routes');
const jsx = readFileSync(join(ROUTES, 'DispensersList.jsx'), 'utf8');
const css = readFileSync(join(ROUTES, 'DispensersList.module.css'), 'utf8');

const CHAIN = 'bitcoin-testnet';
const OWNER = 'tb1qownerownerownerownerownerownerownerow';

afterEach(() => cleanup());

// The option icon names of the Select that carries the given label.
function iconsOfSelect(label) {
    const start = jsx.indexOf(`label="${label}"`);
    const end = jsx.indexOf('</Select>', start);
    const block = jsx.slice(start, end);
    const options = [...block.matchAll(/<Select\.Option value="(\w+)"([^\n]*?)>[^<\n]+<\/Select\.Option>/g)];
    return {
        count: options.length,
        icons: options.map((o) => (o[2].match(/icon=\{<Icon\.(\w+)/) || [])[1]),
    };
}

function cssRule(selector) {
    const m = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : '';
}

describe('My dispensers filter dropdown icons', () => {
    for (const [label, count] of [['Status', 7], ['Sort', 3]]) {
        it(`${label}: every option has its own icon`, () => {
            const { count: n, icons } = iconsOfSelect(label);
            expect(n).toBe(count);
            expect(icons.every(Boolean)).toBe(true);
            expect(new Set(icons).size).toBe(icons.length);
        });
    }
});

describe('My dispensers row status pill', () => {
    it('renders the pill on line one and stock count on line two', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }] }),
            getDispensersForSource: vi.fn().mockResolvedValue({
                data: [{
                    action_index: '40', block_index: 200, source: OWNER,
                    give_tick: 'JAVIERTEST', give_amount: '2', get_coin: 'BTC', get_amount: '0.00001',
                    status: 'valid', current_status: 'open', escrow_remaining: '48', dispense_count: 0,
                }],
            }),
        };
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(DispensersList, { walletId: 'w', onOpenDispenser() {}, onBack() {} }),
            ),
        );
        const row = await screen.findByRole('button', { name: 'Open JAVIERTEST dispenser #40' });
        const pill = within(row).getByText('Open');
        const amount = within(row).getByText('2 JAVIERTEST');
        const price = within(row).getByText('0.00001 BTC');
        const stock = within(row).getByText('24 of 24 left');
        expect(pill.parentElement).toContainElement(amount);
        expect(stock.parentElement).toContainElement(price);
    });

    it('keeps both lines aligned and lets amount words wrap intact', () => {
        const line = (css.match(/\.primaryLine,\s*\.secondaryLine\s*\{([^}]*)\}/) || [])[1] || '';
        expect(line).toMatch(/display:\s*flex/);
        expect(line).toMatch(/justify-content:\s*space-between/);
        expect(line).toMatch(/min-width:\s*0/);
        const amount = (css.match(/\.rowAmount,\s*\.priceText\s*\{([^}]*)\}/) || [])[1] || '';
        expect(amount).toMatch(/overflow-wrap:\s*break-word/);
        expect(amount).toMatch(/word-break:\s*normal/);
        const stock = cssRule('.stockCount');
        expect(stock).toMatch(/white-space:\s*nowrap/);
        const status = cssRule('.status');
        expect(status).toMatch(/flex:\s*0 0 auto/);
        expect(status).toMatch(/white-space:\s*nowrap/);
    });

    it('the phone row keeps fixed icon and chevron columns without breaking words', () => {
        const phone = css.slice(css.indexOf('@media not all and (min-width: 400px)'));
        expect(phone).toMatch(/grid-template-columns:\s*40px minmax\(0, 1fr\) auto/);
        expect(phone).toMatch(/overflow-wrap:\s*break-word/);
        expect(phone).not.toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('uses the required success, warning, and neutral status tones', () => {
        expect(cssRule('.status_open')).toMatch(/var\(--xc-success-bg\)/);
        expect(cssRule('.status_cancelling')).toMatch(/var\(--xc-warning-bg\)/);
        expect(css).toMatch(/\.status_complete,\s*\.status_closed,\s*\.status_empty\s*\{[^}]*var\(--xc-bg-muted\)/);
    });
});
