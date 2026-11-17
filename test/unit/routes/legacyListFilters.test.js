// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = [
    'AccountPicker',
    'AlertsRoute',
    'DispenserExplorer',
    'ObligationsView',
    'WalletPicker',
];

const readRoute = (name) => readFileSync(
    resolve(process.cwd(), `packages/core/src/shared/routes/${name}.jsx`),
    'utf8',
);

describe('walk list filter migrations', () => {
    it.each(ROUTES)('%s uses the standard header ListFilterMenu', (name) => {
        const source = readRoute(name);
        expect(source).toContain("import { ListFilterMenu } from '../components/ListFilterMenu.jsx';");
        expect(source).toMatch(/<ListFilterMenu\b/);
        expect(source).not.toMatch(/ListFilterPopover|ListSearchField/);
    });

    it.each(['AccountPicker', 'WalletPicker'])('%s keeps filter before add in the header', (name) => {
        const source = readRoute(name);
        expect(source.indexOf('<ListFilterMenu')).toBeGreaterThan(-1);
        expect(source.indexOf('<ListFilterMenu')).toBeLessThan(source.indexOf('<Icon.PlusIcon'));
    });

    it('keeps every AlertsRoute filter inside the standard menu', () => {
        const source = readRoute('AlertsRoute');
        const menu = source.slice(source.indexOf('<ListFilterMenu'), source.indexOf('</ListFilterMenu>'));
        expect(menu).toContain('<fieldset');
        expect(menu).toContain('unreadOnly');
        expect(menu).toContain('TYPE_ORDER.map');
    });

    it('keeps DispenserExplorer network filtering and Enter submission in the standard menu', () => {
        const source = readRoute('DispenserExplorer');
        const menu = source.slice(source.indexOf('<ListFilterMenu'), source.indexOf('</ListFilterMenu>'));
        expect(menu).toContain('onSearchKeyDown');
        expect(menu).toContain('<NetworkField');
        expect(menu).toContain('onChange={handleChainFilterChange}');
    });
});
