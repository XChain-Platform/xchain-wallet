// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src');
const read = (...parts) => readFileSync(join(src, ...parts), 'utf8');

const cardCss = read('ui', 'Card.module.css');
const listRowCss = read('ui', 'ListRow.module.css');

describe('wide two-panel list rows', () => {
    it('removes only the opted-in list frame and matches the side-menu row states', () => {
        expect(cardCss).toMatch(/\[data-xc-split-list\]\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;/s);
        expect(listRowCss).toMatch(/\.interactive\[data-xc-split-row\]\s*\{[^}]*width:\s*calc\(100% - \(2 \* var\(--xc-space-2\)\)\);[^}]*margin-inline:\s*var\(--xc-space-2\);[^}]*border-radius:\s*10px;[^}]*box-shadow:\s*none;/s);
        expect(listRowCss).toMatch(/\.interactive\[data-xc-split-row\]:hover:not\(:disabled\)\s*\{[^}]*var\(--xc-text\) 10%[^}]*box-shadow:\s*none;/s);
        expect(listRowCss).toMatch(/\.interactive\[data-xc-split-row\]\[aria-current='true'\]\s*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none[^}]*font-weight:\s*inherit;/s);
        expect(listRowCss).toMatch(/\.interactive:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
    });

    it('opts Contacts, Contracts, Dispensers, Governance, My Tokens and My Agents into the shared wide treatment', () => {
        const routes = [
            'ContactsList.jsx',
            'ContractsList.jsx',
            'DispensersList.jsx',
            'GovernancePolls.jsx',
            'MyTokens.jsx',
            'CoSignerAccountList.jsx',
        ].map((name) => read('shared', 'routes', name));

        for (const route of routes) {
            expect(route).toContain('data-xc-split-list');
            expect(route).toContain('data-xc-split-row');
        }
        expect(routes.join('\n')).not.toContain('listDetailStyles.selectedRow');
    });

    it('keeps custom History, Betting and Staking rows wide-only and rail-free', () => {
        const history = read('shared', 'routes', 'History.jsx');
        const historyRow = read('shared', 'routes', 'HistoryEntryRow.jsx');
        const historyCss = read('shared', 'routes', 'History.module.css');
        const betting = read('shared', 'routes', 'BetFeedsList.jsx');
        const bettingCss = read('shared', 'routes', 'BetFeedsList.module.css');
        const staking = read('shared', 'routes', 'StakingList.jsx');
        const stakingCss = read('shared', 'routes', 'StakingList.module.css');

        expect(history).toContain("wideContent ? null : <li key={run.key}>");
        expect(history).toContain('data-xc-split-list={wideContent');
        expect(historyRow).toContain('data-xc-split-row={splitRow');
        expect(historyCss).toMatch(/\[aria-current='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);

        expect(betting).toContain('data-xc-split-list={twoPanel');
        expect(betting).toContain('className={twoPanel ? local.splitRow');
        expect(bettingCss).toMatch(/\.splitRow\.splitRow\[aria-current='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);

        expect(staking).toContain('data-xc-split-list={showPanel');
        expect(staking).toContain('data-xc-split-row={split');
        expect(stakingCss).toMatch(/\[aria-current='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);
    });

    it('gives Marketplace an explicit split-row variant without changing wide Home', () => {
        const marketplace = read('shared', 'routes', 'MarketActivity.jsx');
        const picker = read('shared', 'routes', 'TokenPicker.jsx');
        const balances = read('shared', 'components', 'BalanceList.jsx');
        const balanceCss = read('shared', 'components', 'BalanceList.module.css');

        expect(marketplace).toMatch(/<TokenPicker[\s\S]*?splitRows[\s\S]*?\/>/);
        expect(picker).toContain('splitRows={splitRows}');
        expect(balances).toContain('data-xc-split-list={splitRows');
        expect(balances).toContain('data-xc-split-row={splitRow');
        expect(balanceCss).toMatch(/\[data-xc-split-row\]\[data-selected='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);
    });

    it('adds the side-menu hover and active colors to Messaging without owning its frame or gap', () => {
        const messagingCss = read('shared', 'routes', 'MessagingInbox.module.css');
        expect(messagingCss).toMatch(/\.convList\[data-wide='true'\] \.convItem:hover\s*\{[^}]*var\(--xc-text\) 10%[^}]*box-shadow:\s*none/s);
        expect(messagingCss).toMatch(/\.convList\[data-wide='true'\] \.convItem\[aria-current='true'\]\s*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none[^}]*font-weight:\s*inherit/s);
    });
});
