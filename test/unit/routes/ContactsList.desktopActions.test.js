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
        expect(contactsRoute).toMatch(/setSendBackTo\('contacts'\)/);
        expect(contactsRoute).toMatch(/setUnlockedView\('send'\)/);
    });

    it('uses the wrapping list-page toolbar with a full-width phone sort control', () => {
        expect(listPageCss).toMatch(/\.toolbar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        expect(contactsCss).toMatch(
            /@media \(max-width: 420px\)[\s\S]*?\.sort\s*\{[\s\S]*?flex:\s*1 1 100%/,
        );
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

    it('lays the five contact actions out as one row of stacked icon tiles', () => {
        const grid = /(?:^|\n)\.quickActions\s*\{([^}]*)\}/.exec(contactsCss)?.[1] || '';
        // A fixed four-column grid left Delete alone on a second row.
        expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(56px,\s*1fr\)\)/);
        // Icon beside label left "Message" too little room, so it broke mid-word.
        const label = /(?:^|\n)\.quickAction > span\s*\{([^}]*)\}/.exec(contactsCss)?.[1] || '';
        expect(label).toMatch(/flex-direction:\s*column/);
    });
});
