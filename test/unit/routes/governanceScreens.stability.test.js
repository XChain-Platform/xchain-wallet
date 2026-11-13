// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const route = (name) => readFileSync(resolve(here, '../../../packages/core/src/shared/routes', name), 'utf8');

describe('governance and staking screen theme colors', () => {
    it.each([
        // The poll status pill's colours live in pollDisplay, shared by the list and the poll page.
        ['pollDisplay.js', 'var(--xc-warning-bg)'],
        // The market status chip lives on the shared Bet Markets card.
        ['../components/BetMarketCard.module.css', 'var(--xc-accent-primary)'],
        // My bets is the Bet Markets tab drawn by BetMyBetsPanel.
        ['../components/BetMyBetsPanel.jsx', 'var(--xc-danger-bg)'],
        ['ContractStakeForm.jsx', 'var(--xc-danger-text)'],
        ['CoinpayForm.module.css', 'var(--xc-accent-primary)'],
        ['OperatorDashboard.jsx', 'var(--xc-border)'],
        ['StakeForm.jsx', 'var(--xc-text-muted)'],
        ['StakingList.module.css', 'var(--xc-on-accent)'],
        ['MyLists.module.css', 'var(--xc-danger-bg)'],
        ['StakeDetail.module.css', 'var(--xc-warning)'],
        ['StakingList.module.css', "from '../../ui/Card.module.css'"],
    ])('%s uses a palette token for the audited color', (file, token) => {
        expect(route(file)).toContain(token);
    });

    it('ProjectRosterForm.jsx takes its roster field colors from the kit Textarea', () => {
        const source = route('ProjectRosterForm.jsx');
        expect(source).toContain('<Textarea');
        expect(source).not.toMatch(/background:\s*'#/);
    });

    it.each([
        ['GovernancePolls.jsx', ["'#1b5e20'", "'#8e1c1c'", "'#8a6d00'", "'#fff'"]],
        ['pollDisplay.js', ["'#1b5e20'", "'#8e1c1c'", "'#8a6d00'", "'#fff'"]],
        ['BetFeedsList.jsx', ["'#1b5e20'", "'#8e1c1c'", "'#4a4a4a'", "'#0d47a1'", "'#fff'"]],
        ['../components/BetMyBetsPanel.jsx', ["'#1b5e20'", "'#8e1c1c'", "'#4a4a4a'", "'#0d47a1'", "'#fff'"]],
        ['StakeForm.jsx', ['var(--border,', 'var(--muted,']],
        // Its muted explanation paragraphs moved into the Amount help tip (U57);
        // no hard-coded color may come back in their place.
        ['StakingActionForm.jsx', ["color: '#", "'#fff'", 'var(--muted,']],
        ['StakingList.module.css', ['var(--color-border,', 'var(--color-surface-raised,', 'var(--xc-info,', 'background: #FFFFFF']],
        ['MyLists.module.css', ['background: #FFFFFF', 'background: rgba(34', 'background: rgba(220']],
    ])('%s does not retain the dark-mode-breaking value', (file, forbidden) => {
        const source = route(file);
        for (const value of forbidden) expect(source).not.toContain(value);
    });
});

describe('governance screen narrow layout', () => {
    it('the My bets tab lays bet rows out through the shared ListRow', () => {
        const source = route('../components/BetMyBetsPanel.jsx');
        expect(source).toContain('<ListRow');
        const rows = source.split('\n').filter((line) => (
            line.includes("display: 'flex'") && line.includes("justifyContent: 'space-between'")
        ));
        expect(rows.every((line) => line.includes("flexWrap: 'wrap'"))).toBe(true);
    });

    // OracleRecord lays its rows out with classes now, so it may hold none of
    // these inline rows; any it does hold must wrap.
    it.each([
        ['BetFeedDetail.jsx', true],
        ['OracleRecord.jsx', false],
    ])('%s wraps every space-between user-data row', (file, mustHaveRows) => {
        const rows = route(file).split('\n').filter((line) => (
            line.includes("display: 'flex'") && line.includes("justifyContent: 'space-between'")
        ));
        if (mustHaveRows) expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((line) => line.includes("flexWrap: 'wrap'"))).toBe(true);
    });

    it('keeps betting market card text shrinkable and its footer wrapping', () => {
        const source = route('BetFeedsList.jsx');
        const card = readFileSync(resolve(here, '../../../packages/core/src/shared/components/BetMarketCard.module.css'), 'utf8');
        expect(source).toContain('<BetMarketCard');
        expect(card).toMatch(/\.topText\s*\{[\s\S]*?min-width:\s*0/);
        expect(card).toMatch(/\.ref\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(card).toMatch(/\.question\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(card).toMatch(/\.foot\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    });

    it('wraps Oracle Console market headers through its phone layout styles', () => {
        const source = route('OracleConsole.jsx');
        const css = route('OracleConsole.module.css');
        expect(source).toContain('className={consoleStyles.marketHeader}');
        expect(css).toMatch(/\.marketHeader\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    });

    it('uses the wrapping section header template for contract detail groups', () => {
        expect(route('ContractDetail.jsx')).toContain('<SectionHeader');
    });

    it('keeps contract row text inside a shrinkable column', () => {
        const source = route('ContractsList.jsx');
        expect(source.match(/<span className=\{styles\.entryText\}>/g)).toHaveLength(2);
    });

    it('lets the page own vertical scrolling for long list edits', () => {
        const source = route('ListForkForm.jsx');
        expect(source).not.toContain("maxHeight: '260px'");
        expect(source).not.toContain("overflowY: 'auto'");
    });

    it('keeps governance cards, option rows, and result values shrinkable', () => {
        const polls = route('GovernancePolls.module.css');
        const detail = route('PollDetail.module.css');
        // Poll cards are ListRows, whose content column shrinks beside the status pill.
        expect(route('GovernancePolls.jsx')).toContain('<ListRow');
        expect(polls).toMatch(/\.pollText\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        // Each result row (swatch, option, values) wraps at narrow widths.
        expect(detail).toMatch(/\.resultItem\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        expect(detail).toMatch(/\.question\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(detail).toMatch(/\.resultOption\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(detail).toMatch(/\.resultValues > span\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(detail).toMatch(/\.splitOptionInput :global\(label\)\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(detail).toMatch(/\.optionLabel\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(detail).toMatch(/@media not all and \(min-width:\s*400px\)[\s\S]*?\.resultValues\s*\{[\s\S]*?flex:\s*1 1 100%/);
    });
});
