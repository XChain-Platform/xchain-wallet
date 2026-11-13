// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// At phone width the search box shrinks and the network filter
// stays on the same row at its own width. jsdom has no layout, so the
// test pins the rules that make that happen.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readCss = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const routeCss = (name) => readCss(`packages/core/src/shared/routes/${name}.module.css`);
const source = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ContactsList.jsx'),
    'utf8',
);
const addressListSource = readCss('packages/core/src/shared/routes/AddressList.jsx');
const tabsCss = readCss('packages/core/src/ui/Tabs.module.css');
const listPageCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/ListPage.module.css'),
    'utf8',
);


function rule(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

const toolbarCss = readCss('packages/core/src/shared/components/ListToolbar.module.css');

describe('list toolbar at phone width', () => {
    it('puts the contacts search, network filter and sort in the shared ListToolbar', () => {
        expect(source).toMatch(/toolbar=\{\(\s*<ListToolbar\b[\s\S]*?<NetworkFilterDropdown[\s\S]*?<Select[\s\S]*?<\/ListToolbar>/);
    });

    it('lets the toolbar wrap', () => {
        const pageToolbar = listPageCss.match(/\.toolbar\s*\{[^}]*\}/)[0];
        expect(pageToolbar).toMatch(/flex-wrap:\s*wrap/);
        expect(rule(toolbarCss, '.toolbar')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('lets the search box shrink while each filter keeps its width, wrapping only as a fallback', () => {
        expect(rule(toolbarCss, '.search')).toMatch(/flex:\s*1 1 9rem/);
        expect(rule(toolbarCss, '.filter')).toMatch(/flex:\s*0 1 auto/);
    });
});

describe('list toolbar control alignment', () => {
    const mediumControl = (text, selector) => {
        const body = rule(text, selector);
        expect(body).toMatch(/height:\s*var\(--xc-control-h-md\)/);
        expect(body).toMatch(/font-size:\s*var\(--xc-control-font-md,\s*var\(--xc-control-font\)\)/);
        expect(body).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);
    };

    it('centres shared toolbar rows and removes field wrapper spacing', () => {
        const listPage = readCss('packages/core/src/ui/ListPage.module.css');
        const toolbar = rule(listPage, '.toolbar');
        expect(toolbar).toMatch(/align-items:\s*center/);
        expect(toolbar).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule(listPage, '.toolbar > div')).toMatch(/margin-bottom:\s*0/);
    });

    it('uses the shared medium Input for every route search field', () => {
        const toolbar = readCss('packages/core/src/shared/components/ListToolbar.jsx');
        expect(toolbar).toMatch(/<Input[\s\S]*?type="search"[\s\S]*?size="md"/);
        for (const name of ['MyLists', 'ContactsList', 'MessagingInbox']) {
            expect(readCss(`packages/core/src/shared/routes/${name}.jsx`)).toMatch(/<ListToolbar\b/);
        }
        // Lists that moved their search to the title-bar filter panel get the same
        // medium Input from the shared ListFilterMenu, never a toolbar of their own.
        const filterMenu = readCss('packages/core/src/shared/components/ListFilterMenu.jsx');
        expect(filterMenu).toMatch(/<Input[\s\S]*?size="md"/);
        for (const name of ['DispensersList', 'StakingList', 'AddressList']) {
            const route = readCss(`packages/core/src/shared/routes/${name}.jsx`);
            expect(route).toMatch(/<ListFilterMenu\b/);
            expect(route).not.toMatch(/<ListToolbar\b/);
        }
        mediumControl(routeCss('AddressList'), '.searchField input');
    });

    it('keeps the shared medium-height underline tabs and picks address types from the filter panel', () => {
        expect(addressListSource).toMatch(/<IconSelect[\s\S]*?value=\{sourceFilter\}/);
        expect(rule(tabsCss, '.tabs')).toMatch(/min-height:\s*var\(--xc-control-h-md\)/);
        expect(rule(tabsCss, '.tab')).toMatch(/min-height:\s*var\(--xc-control-h-md\)/);
        expect(rule(tabsCss, '.tab')).toMatch(/border-bottom:\s*2px solid transparent/);
    });
});
