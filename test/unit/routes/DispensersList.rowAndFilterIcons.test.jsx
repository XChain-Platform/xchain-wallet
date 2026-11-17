// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// My dispensers: the Status and Sort dropdowns carry a distinct icon on
// every option (like the network filter), and the status pill stays at the
// right of the price line on narrow windows: the price truncates, the pill
// never shrinks or wraps.

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
    it('renders the pill beside the price inside one price line', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }] }),
            getDispensersForSource: vi.fn().mockResolvedValue({
                data: [{
                    action_index: '40', block_index: 200, source: OWNER,
                    give_tick: 'JAVIERTEST', give_amount: '2', get_coin: 'BTC', get_amount: '0.00001',
                    status: 'valid', current_status: 'open', escrow_remaining: '48',
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
        const line = pill.parentElement;
        expect(line.children.length).toBe(2);
        expect(line.children[0].textContent).toMatch(/JAVIERTEST/);
        expect(line.children[1]).toBe(pill);
        // The escrow line is a separate line below.
        expect(line.nextElementSibling.textContent).toMatch(/in escrow/);
    });

    it('the price line is nowrap; the price truncates with min-width 0; the pill never shrinks', () => {
        const line = cssRule('.priceLine');
        expect(line).toMatch(/display:\s*flex/);
        expect(line).toMatch(/flex-wrap:\s*nowrap/);
        expect(line).toMatch(/min-width:\s*0/);
        const price = cssRule('.price');
        expect(price).toMatch(/min-width:\s*0/);
        expect(price).toMatch(/text-overflow:\s*ellipsis/);
        expect(price).toMatch(/white-space:\s*nowrap/);
        expect(price).toMatch(/overflow:\s*hidden/);
        const status = cssRule('.status');
        expect(status).toMatch(/flex:\s*0 0 auto/);
        expect(status).toMatch(/white-space:\s*nowrap/);
    });

    it('no phone rule lets the price wrap or moves the pill to its own line', () => {
        const phone = css.slice(css.indexOf('@media not all and (min-width: 400px)'));
        expect(phone).not.toMatch(/white-space:\s*normal/);
        expect(phone).not.toMatch(/grid-row/);
    });
});
