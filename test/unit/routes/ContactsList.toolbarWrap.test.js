// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// At phone width the sort control drops to its own row so the network filter
// keeps room for its full "All Networks" label. jsdom has no layout, so the
// test pins the rules that make that happen.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readCss = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const routeCss = (name) => readCss(`packages/core/src/shared/routes/${name}.module.css`);
const css = routeCss('ContactsList');

function rule(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] || '';
}

describe('ContactsList toolbar at phone width', () => {
    it('lets the toolbar wrap', () => {
        const rule = css.match(/\.toolbar\s*\{[^}]*\}/)[0];
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
    });

    it('gives the sort control its own row at 420px and below', () => {
        const media = css.match(/@media \(max-width: 420px\)\s*\{[^}]*\{[^}]*\}\s*\}/)[0];
        expect(media).toMatch(/\.sort\s*\{[^}]*flex:\s*1 1 100%/);
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

    it('uses medium control tokens for every route search field', () => {
        for (const name of ['DispensersList', 'MyLists', 'StakingList', 'MessagingInbox']) {
            mediumControl(routeCss(name), '.search');
        }
        mediumControl(routeCss('ContactsList'), '.search input');
        mediumControl(routeCss('AddressList'), '.searchField input');
    });

    it('uses medium control tokens for the address type segments', () => {
        const addressList = routeCss('AddressList');
        const segmented = rule(addressList, '.segmented');
        expect(segmented).toMatch(/height:\s*var\(--xc-control-h-md\)/);
        expect(segmented).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);
        expect(rule(addressList, '.segment'))
            .toMatch(/font-size:\s*var\(--xc-control-font-md,\s*var\(--xc-control-font\)\)/);
    });
});
