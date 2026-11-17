// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import desktopApp from '../../../packages/desktop/renderer/App.jsx?raw';

const contactsCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ContactsList.module.css'),
    'utf8',
);
const listPageCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/ListPage.module.css'),
    'utf8',
);

describe('Contacts desktop actions and narrow layout', () => {
    it('wires Send to the desktop send screen', () => {
        const contactsRoute = desktopApp.match(
            /if \(unlockedView === 'contacts'[\s\S]*?\{([\s\S]*?)if \(unlockedView === 'contracts-list'/,
        )?.[1] || '';

        expect(contactsRoute).toMatch(/onSend=\{\(prefill\) => \{/);
        expect(contactsRoute).toMatch(/setSendPrefill\(prefill\)/);
        // Send opens on top of Contacts in the history, so its Back returns here.
        expect(contactsRoute).toMatch(/setUnlockedView\('send'\)/);
        expect(contactsRoute).toMatch(/onBack=\{goBack\}/);
    });

    it('uses the wrapping list-page toolbar with a full-width phone sort control', () => {
        expect(listPageCss).toMatch(/\.toolbar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        const toolbarCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/components/ListToolbar.module.css'),
            'utf8',
        );
        // The search box shrinks and the sort select keeps its own width on the same row.
        expect(toolbarCss).toMatch(/\.filter\s*\{[\s\S]*?flex:\s*0 1 auto/);
    });

    it('ends a long contact name in an ellipsis inside the row', () => {
        const name = /(?:^|\n)\.rowName\s*\{([^}]*)\}/.exec(contactsCss)?.[1] || '';
        // The name sits in the kit ListRow title slot as a span; inline, it
        // ignored overflow and ran under the network icons.
        expect(name).toMatch(/display:\s*block/);
        expect(name).toMatch(/text-overflow:\s*ellipsis/);
        expect(name).toMatch(/white-space:\s*nowrap/);
        expect(name).toMatch(/overflow:\s*hidden/);
    });

    // G101 (2026-11-13): the five contact actions are rows of the shared
    // action list, so the page paints no tile grid of its own.
    it('draws the five contact actions as the shared action list, not tiles', () => {
        expect(contactsCss).not.toMatch(/(?:^|\n)\.quickActions?\b/);
        const contactsJsx = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/ContactsList.jsx'),
            'utf8',
        );
        expect(contactsJsx).toMatch(/<ActionList label="Contact actions">/);
        // Counted inside the contact list only: View Address has its own list.
        const contactActions = contactsJsx.split('<ActionList label="Contact actions">')[1].split('</ActionList>')[0];
        expect(contactActions.match(/<ActionListItem\b/g)).toHaveLength(5);
    });
});
