// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src');
const read = (...parts) => readFileSync(join(src, ...parts), 'utf8');

const cardCss = read('ui', 'Card.module.css');
const listRowCss = read('ui', 'ListRow.module.css');
const panelCss = read('shared', 'components', 'PanelSplit.module.css');

afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll('[data-two-panel-test]').forEach((node) => node.remove());
});

describe('wide two-panel list rows', () => {
    it('keeps the opted-in list frame and matches the side-menu row colours', () => {
        expect(cardCss).toMatch(/:root \[data-xc-split-list\]\s*\{[^}]*background:\s*var\(--xc-card-bg\);[^}]*border:\s*var\(--xc-card-border\);[^}]*border-radius:\s*var\(--xc-card-radius\);[^}]*overflow:\s*hidden;/s);
        expect(listRowCss).toMatch(/\.interactive\[data-xc-split-row\]\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
        expect(listRowCss).toMatch(/\.interactive\[data-xc-split-row\]:hover:not\(:disabled\)\s*\{[^}]*var\(--xc-text\) 10%[^}]*box-shadow:\s*none;/s);
        expect(listRowCss).toMatch(/\.interactive\[data-xc-split-row\]\[aria-current='true'\]\s*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none[^}]*font-weight:\s*inherit;/s);
        expect(listRowCss).toMatch(/\.interactive:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
    });

    it('measures the wide frame, header gap and edge-to-edge selected fill', () => {
        const style = document.createElement('style');
        style.dataset.twoPanelTest = '';
        // jsdom keeps custom properties and logical properties unresolved in
        // computed styles. Substitute the real 8px tokens before measuring.
        style.textContent = `${cardCss}\n${listRowCss}\n${panelCss}`
            .replaceAll('var(--xc-card-bg)', 'rgb(20, 24, 32)')
            .replaceAll('var(--xc-card-border)', '1px solid rgb(90, 96, 108)')
            .replaceAll('var(--xc-card-radius)', '8px')
            .replaceAll('var(--xc-space-2)', '8px')
            .replaceAll('var(--xc-radius-md)', '8px');
        document.head.append(style);

        const scroller = document.createElement('div');
        scroller.className = 'listBody';
        const card = document.createElement('div');
        card.className = 'flush';
        card.dataset.xcSplitList = '';
        const row = document.createElement('button');
        row.className = 'row interactive';
        row.dataset.xcSplitRow = '';
        row.setAttribute('aria-current', 'true');
        card.append(row);
        scroller.append(card);
        document.body.append(scroller);

        const scrollerStyle = getComputedStyle(scroller);
        const cardStyle = getComputedStyle(card);
        const rowStyle = getComputedStyle(row);
        const measuredCardTop = Number.parseFloat(scrollerStyle.paddingBlockStart || '0')
            + Number.parseFloat(cardStyle.marginTop || '0');

        expect(measuredCardTop).toBe(8);
        expect(cardStyle.borderTopWidth).toBe('1px');
        expect(cardStyle.borderTopStyle).toBe('solid');
        expect(cardStyle.borderRadius).toBe('8px');
        expect(cardStyle.overflow).toBe('hidden');
        expect(rowStyle.width).toBe('100%');
        expect(rowStyle.marginInline).toBe('0');
        expect(rowStyle.borderRadius).toBe('0');
    });

    it('opts Contacts, Contracts, Governance, My Tokens and My Agents into the shared wide treatment', () => {
        const routes = [
            'ContactsList.jsx',
            'ContractsList.jsx',
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
        expect(historyCss).toMatch(/\.row\.row\[data-xc-split-row\]\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*border-radius:\s*0;/s);
        expect(historyCss).toMatch(/\[aria-current='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);

        expect(betting).toContain('data-xc-split-list={twoPanel');
        expect(betting).toContain('className={twoPanel ? local.splitRow');
        expect(bettingCss).toMatch(/\.splitRow\.splitRow\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;/s);
        expect(bettingCss).toMatch(/\.splitRow\.splitRow\[aria-current='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);

        expect(staking).toContain('data-xc-split-list={showPanel');
        expect(staking).toContain('data-xc-split-row={split');
        expect(stakingCss).toMatch(/\.rowItem\[data-xc-split-item\] > \.row\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;/s);
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
        expect(balanceCss).toMatch(/\.row\[data-xc-split-row\]\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*border-top-color:\s*transparent;[^}]*border-radius:\s*0;/s);
        expect(balanceCss).toMatch(/\[data-xc-split-row\]\[data-selected='true'\][^{]*\{[^}]*var\(--xc-accent-primary\) 20%[^}]*box-shadow:\s*none/s);
    });

    it('keeps Messaging framed with full-width hover and active fills', () => {
        const messagingCss = read('shared', 'routes', 'MessagingInbox.module.css');
        expect(messagingCss).toMatch(/\.convList\s*\{[^}]*composes:\s*flush from '\.\.\/\.\.\/ui\/Card\.module\.css';[^}]*overflow:\s*hidden;/s);
        expect(messagingCss).not.toMatch(/\.convList\[data-wide='true'\]\s*\{[^}]*(?:border:\s*0|border-radius:\s*0)/s);
        expect(messagingCss).toMatch(/\.convList\[data-wide='true'\] \.convItem:hover\s*\{[^}]*var\(--xc-text\) 10%[^}]*box-shadow:\s*none/s);
        expect(messagingCss).toMatch(/\.convList\[data-wide='true'\] \.convItem\[aria-current='true'\]\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*var\(--xc-accent-primary\) 20%[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none[^}]*font-weight:\s*inherit/s);
    });
});
