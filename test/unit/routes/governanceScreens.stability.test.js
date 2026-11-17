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
        // The card's "You bet" chip and chevron (the status pill is gone, ruling 2026-11-13).
        ['../components/BetMarketCard.module.css', 'var(--xc-accent-text)'],
        // The one Staking form: the contract penalty warning and the capability readout.
        ['StakingForm.jsx', 'var(--xc-danger-text)'],
        ['CoinpayForm.module.css', 'var(--xc-accent-primary)'],
        ['StakingForm.jsx', 'var(--xc-text-muted)'],
        ['StakingList.module.css', 'var(--xc-on-accent)'],
        ['MyLists.module.css', 'var(--xc-danger-bg)'],
        ['StakeDetail.module.css', 'var(--xc-success)'],
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
        // The one Staking form. The unstake and claim explanation paragraphs
        // moved into the Amount help tip (U57); no hard-coded color may come
        // back in their place.
        ['StakingForm.jsx', ['var(--border,', 'var(--muted,', "color: '#", "'#fff'"]],
        ['StakingList.module.css', ['var(--color-border,', 'var(--color-surface-raised,', 'var(--xc-info,', 'background: #FFFFFF']],
        ['MyLists.module.css', ['background: #FFFFFF', 'background: rgba(34', 'background: rgba(220']],
    ])('%s does not retain the dark-mode-breaking value', (file, forbidden) => {
        const source = route(file);
        for (const value of forbidden) expect(source).not.toContain(value);
    });
});

describe('governance screen narrow layout', () => {
    // My bets is the All list narrowed (ruling 2026-11-13): the bets file
    // holds the loader and the card chip only, and draws no rows of its own.
    it('the My bets tab draws no rows of its own, only the Prediction markets cards', () => {
        const source = route('../components/BetMyBetsPanel.jsx');
        expect(source).not.toContain('<ListRow');
        expect(source).not.toMatch(/export function BetMyBetsPanel\b/);
        expect(route('BetFeedsList.jsx')).not.toContain('<BetMyBetsPanel');
    });

    // BetFeedDetail (on the shared outcome page) and OracleRecord lay their
    // rows out with classes now, so they may hold none of these inline rows;
    // any they do hold must wrap.
    it.each([
        ['BetFeedDetail.jsx', false],
        ['OracleRecord.jsx', false],
    ])('%s wraps every space-between user-data row', (file, mustHaveRows) => {
        const rows = route(file).split('\n').filter((line) => (
            line.includes("display: 'flex'") && line.includes("justifyContent: 'space-between'")
        ));
        if (mustHaveRows) expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((line) => line.includes("flexWrap: 'wrap'"))).toBe(true);
    });

    it('keeps shared question-card text and footers shrinkable', () => {
        const source = route('BetFeedsList.jsx');
        const card = readFileSync(resolve(here, '../../../packages/core/src/shared/components/BetMarketCard.module.css'), 'utf8');
        expect(source).toContain('<BetMarketCard');
        expect(card).toMatch(/\.detail\s*\{[\s\S]*?min-width:\s*0/);
        expect(card).toMatch(/\.question\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
        expect(card).toMatch(/\.right \.chip\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
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
        // Contract rows are shared ListRows; their text column shrinks and wraps.
        const source = route('ContractsList.jsx');
        expect(source).toMatch(/<ListRow\s+className=\{contractStyles\.contractRow\}/);
        expect(route('ContractScreens.module.css')).toMatch(/\.contractRow > span:nth-child\(2\)\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/);
    });

    it('lets the page own vertical scrolling for long list edits', () => {
        // The List form's Edit and Fork body holds the long member list.
        const source = route('ListCreateForm.jsx');
        expect(source).not.toContain("maxHeight: '260px'");
        expect(source).not.toContain("overflowY: 'auto'");
    });

    it('keeps governance cards, option rows, and result values shrinkable', () => {
        const polls = readFileSync(resolve(here, '../../../packages/core/src/shared/components/QuestionList.module.css'), 'utf8');
        const detail = route('PollDetail.module.css');
        const outcome = readFileSync(resolve(here, '../../../packages/core/src/shared/components/outcomeDetail/OutcomeDetail.module.css'), 'utf8');
        expect(route('GovernancePolls.jsx')).toContain('<QuestionCard');
        expect(polls).toMatch(/\.answerLabel\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
        // The poll page is the shared outcome page: the hero question, each
        // final result row (name, winner pill, share) and its figures wrap.
        expect(outcome).toMatch(/\.question\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
        expect(outcome).toMatch(/\.resultTop\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        expect(outcome).toMatch(/\.resultName\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
        expect(outcome).toMatch(/\.resultSub\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
        expect(outcome).toMatch(/\.pickCheck\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
        expect(detail).toMatch(/\.splitOptionInput :global\(label\)\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
        expect(detail).toMatch(/\.optionLabel\s*\{[\s\S]*?overflow-wrap:\s*break-word/);
    });
});
