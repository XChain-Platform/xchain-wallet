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
        ['GovernancePolls.jsx', 'var(--xc-warning-bg)'],
        ['BetFeedsList.jsx', 'var(--xc-accent-primary)'],
        ['MyBets.jsx', 'var(--xc-danger-bg)'],
        ['ContractStakeForm.jsx', 'var(--xc-danger-text)'],
        ['CoinpayForm.jsx', 'var(--xc-accent-primary)'],
        ['OperatorDashboard.jsx', 'var(--xc-border)'],
        ['ProjectRosterForm.jsx', 'var(--xc-surface)'],
        ['StakeForm.jsx', 'var(--xc-text-muted)'],
        ['StakingActionForm.jsx', 'var(--xc-text-muted)'],
        ['StakingList.jsx', 'var(--xc-on-accent)'],
        ['MyLists.module.css', 'var(--xc-danger-bg)'],
        ['StakeDetail.module.css', 'var(--xc-warning)'],
        ['StakingList.module.css', 'var(--xc-surface-raised)'],
    ])('%s uses a palette token for the audited color', (file, token) => {
        expect(route(file)).toContain(token);
    });

    it.each([
        ['GovernancePolls.jsx', ["'#1b5e20'", "'#8e1c1c'", "'#8a6d00'", "'#fff'"]],
        ['BetFeedsList.jsx', ["'#1b5e20'", "'#8e1c1c'", "'#4a4a4a'", "'#0d47a1'", "'#fff'"]],
        ['MyBets.jsx', ["'#1b5e20'", "'#8e1c1c'", "'#4a4a4a'", "'#0d47a1'", "'#fff'"]],
        ['StakeForm.jsx', ['var(--border,', 'var(--muted,']],
        ['StakingList.module.css', ['var(--color-border,', 'var(--color-surface-raised,', 'var(--xc-info,', 'background: #FFFFFF']],
        ['MyLists.module.css', ['background: #FFFFFF', 'background: rgba(34', 'background: rgba(220']],
    ])('%s does not retain the dark-mode-breaking value', (file, forbidden) => {
        const source = route(file);
        for (const value of forbidden) expect(source).not.toContain(value);
    });
});

describe('governance screen narrow layout', () => {
    it.each([
        'GovernancePolls.jsx',
        'BetFeedsList.jsx',
        'MyBets.jsx',
        'BetFeedDetail.jsx',
        'OracleRecord.jsx',
    ])('%s wraps every space-between user-data row', (file) => {
        const rows = route(file).split('\n').filter((line) => (
            line.includes("display: 'flex'") && line.includes("justifyContent: 'space-between'")
        ));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((line) => line.includes("flexWrap: 'wrap'"))).toBe(true);
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
});
