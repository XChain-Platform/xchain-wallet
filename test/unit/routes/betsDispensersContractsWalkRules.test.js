// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Standing walk rules on the dispenser, staking, contract and bet screens:
// every drill-in row ends in the standard chevron at every width (G07, G97),
// status pills and fact labels are sentence case, icon tabs put the icon left
// of the word (G13, G40), and the explorer's tabs sit directly on the list (G41).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'packages/core/src/shared');
const read = (path) => readFileSync(join(root, path), 'utf8');
const narrow = (css) => css.slice(css.indexOf('@media not all and (min-width: 400px)'));

describe('dispenser, staking, contract and bet walk rules', () => {
    it('keeps the chevron in its own end column on phone-width dispenser and staking rows', () => {
        const dispensers = narrow(read('routes/DispensersList.module.css'));
        expect(dispensers).toMatch(/grid-template-columns:\s*40px minmax\(0, 1fr\) auto/);
        expect(dispensers).toMatch(/\.row > :last-child\s*\{[^}]*grid-column:\s*3;/);
        const staking = narrow(read('routes/StakingList.module.css'));
        expect(staking).toMatch(/grid-template-columns:\s*var\(--xc-control-h-md\) minmax\(0, 1fr\) auto/);
        expect(staking).toMatch(/\.rowChevron\s*\{[^}]*grid-column:\s*3;/);
    });

    it('draws list status pills in sentence case, not uppercase', () => {
        for (const file of ['routes/DispensersList.module.css', 'routes/StakingList.module.css']) {
            const status = read(file).match(/\n\.status\s*\{[^}]*\}/)[0];
            expect(status, file).toMatch(/text-transform:\s*none/);
        }
        expect(read('routes/StakingList.jsx')).toContain('{stakeStatusLabel(row.status)}');
    });

    it('reads Dispenser detail facts label-left in sentence case', () => {
        expect(read('routes/DispenserDetail.module.css'))
            .toMatch(/\.card > dl > dt\s*\{[^}]*text-transform:\s*none;[^}]*letter-spacing:\s*normal/);
        // The reopen note is a WarningCard, not a loose paragraph.
        expect(read('routes/DispenserDetail.jsx')).toMatch(/<WarningCard data-testid="reopen-origin-note">/);
    });

    it('puts each Contract detail tab icon left of its word and ends function rows in the standard chevron', () => {
        // Layout 3 (2026-11-14): the shared Actions | Details | Activity
        // toggle draws the tabs, and every function is an action-list row,
        // which ends in the kit ListRow chevron.
        const page = read('routes/ContractDetail.jsx');
        expect(page).toMatch(/<ActionsDetailsToggle\b/);
        expect(page).not.toMatch(/<Tabs\b/);
        expect(page).not.toMatch(/fnChevron|tabLabel/);
        expect(page).toMatch(/fnRows\.map\(\(fn\) => \(\s*<ActionListItem\b/);
    });

    it('sets the explorer tabs directly on the list and ends each card in the standard chevron', () => {
        expect(read('routes/DispenserExplorer.jsx')).not.toMatch(/rankNote/);
        const card = read('components/DispenserExplorerCard.jsx');
        expect(card).not.toMatch(/ArrowRightIcon/);
        expect(card).toMatch(/data-row-chevron aria-hidden="true"><Icon\.ForwardIcon \/>/);
        // A row prints no address; the icon's chain badge names the network.
        expect(card).not.toMatch(/AddressText/);
    });

    it('draws the dispenser Expiration as the icon dropdown and the lists as picker fields', () => {
        const form = read('routes/DispenserForm.jsx');
        expect(form).not.toMatch(/<RadioGroup\b/);
        // The shared ExpirationFields draws the icon dropdown (G44).
        expect(form).toMatch(/<ExpirationFields\b/);
        expect(form).not.toMatch(/Set Allow-List|Set Block-List/);
        expect(form.match(/<ListField\b/g)).toHaveLength(2);
    });

    it('keeps notes on the bet screens in WarningCards', () => {
        const bet = read('routes/CreateBetFeedForm.jsx');
        expect(bet).toMatch(/<WarningCard className=\{bet\.duplicatedNote\}/);
        expect(bet).toMatch(/<WarningCard data-bet-create-permanent="">/);
        expect(bet).not.toMatch(/<p className=\{styles\.hint\}>\s*The terms you just set/);
    });
});
