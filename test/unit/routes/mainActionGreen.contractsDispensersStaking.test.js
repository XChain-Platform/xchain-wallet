// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Rulings U63, U60 and U56 on the dispenser, contract and staking screens:
// each screen's main forward action is the green success button with an
// icon and a named action (never Preview), action forms open on Network then
// From, and optional fields use the Optional pill rather than "(optional)".

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name) => readFileSync(resolve(process.cwd(), `packages/core/src/shared/routes/${name}.jsx`), 'utf8');

/** The JSX attributes of the first <Tag> whose children end with `label`. */
function elementFor(source, tag, label) {
    const re = new RegExp(`<${tag}\\b((?:(?!<${tag}\\b)[\\s\\S])*?)>\\s*${label}\\s*</${tag}>`);
    const m = source.match(re);
    return m ? m[1] : null;
}

/** The JSX attributes of the first <Button> whose attributes carry `marker`. */
function buttonWith(source, marker) {
    const re = new RegExp(`<Button\\b((?:(?!<Button\\b)[\\s\\S])*?${marker}[\\s\\S]*?)>`);
    const m = source.match(re);
    return m ? m[1] : null;
}

// Each form's one action is a FormAction (the shared green primary button
// with an icon and a Title Case verb), passed as FormFrame's `action`.
const FORM_ACTIONS = [
    ['DispenserForm', 'Create Dispenser'],
    ['DeployContractForm', 'Publish Contract'],
    ['ExecuteContractForm', "\\{t\\('execute\\.callContract'\\)\\}"],
    ['ContractFundsForm', '\\{verb\\}'],
    // The one Staking form names its action from the action table
    // ('Stake', 'Unstake', 'Delegate Key', 'Claim Rewards', ...).
    ['StakingForm', '\\{cfg\\.submitLabel\\(singleEncode\\)\\}'],
];

// Pages with no form: the contract page's actions are action-list rows;
// the lists keep their forward action as a plus icon in the title bar.
const TITLE_BAR_ACTIONS = [
    ['ContractsList', 'aria-label="Publish contract"'],
    ['StakingList', 'aria-label="New Stake"'],
];

describe('main actions on the dispenser, contract and staking screens (U63)', () => {
    it.each(FORM_ACTIONS)('%s draws its main action as a FormAction with an icon', (name, label) => {
        const attrs = elementFor(read(name), 'FormAction', label);
        expect(attrs, `${name}: main action not found`).not.toBeNull();
        expect(attrs).toMatch(/icon=\{/);
    });

    it('FormAction renders the green success button', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/components/formStandard/FormAction.jsx'), 'utf8');
        expect(source).toMatch(/<Button\b[^>]*variant="success"[^>]*icon=\{icon\}/);
    });

    // G101 (2026-11-13): the contract page's actions are one action list,
    // never a green button. Layout 3 (2026-11-14): Deposit leads it, and the
    // contract's functions and Call by name are rows of a second list.
    it('ContractDetail draws Deposit as the first action-list row with an icon', () => {
        const source = read('ContractDetail');
        const row = source.match(/<ActionListItem\b([\s\S]*?)\n\s*\/>/);
        expect(row, 'ContractDetail: first action row not found').not.toBeNull();
        expect(row[1]).toMatch(/title="Deposit"/);
        expect(row[1]).toMatch(/icon=\{/);
        expect(source).toMatch(/title="Call by name"/);
        expect(source).not.toMatch(/variant="success"/);
    });

    it.each(TITLE_BAR_ACTIONS)('%s keeps its forward action as an icon button in the title bar', (name, marker) => {
        const attrs = buttonWith(read(name), marker);
        expect(attrs, `${name}: title-bar action not found`).not.toBeNull();
        expect(attrs).toMatch(/icon=\{<Icon\.PlusIcon \/>\}/);
        expect(attrs).not.toMatch(/variant="success"/);
    });

    it('DispenserExplorer searches from the filter panel, with no search button', () => {
        const source = read('DispenserExplorer');
        expect(source).toMatch(/<ListFilterMenu[\s\S]*onSearchKeyDown=/);
        expect(source).not.toMatch(/<ListFilterPopover|<ListSearchField/);
        expect(source).not.toMatch(/variant="ghost"/);
    });

    it('ContractDetail greens no button: its actions are list rows', () => {
        const source = read('ContractDetail');
        const greens = (source.match(/variant="success"/g) || []).length + (source.match(/<FormAction\b/g) || []).length;
        expect(greens).toBe(0);
    });

    // Each form page greens its one FormAction; its result page, a separate
    // page, greens its one Done with the check icon (U63, resultDoneGreen).
    it.each(FORM_ACTIONS.map(([name]) => name))('%s greens one button per page', (name) => {
        const source = read(name);
        expect(source.match(/<FormAction\b/g)).toHaveLength(1);
        expect(source.match(/variant="success"/g)).toHaveLength(1);
        expect(source).toMatch(
            /<Button variant="success" icon=\{<Icon\.CheckIcon \/>\} onClick=\{[^}]+\}>(?:Done|\{t\('common\.done'\)\})<\/Button>/,
        );
    });

    it.each(TITLE_BAR_ACTIONS.map(([name]) => name))('%s greens no button', (name) => {
        expect(read(name).match(/variant="success"/g)).toBeNull();
    });

    it.each(['DispenserForm', 'DeployContractForm', 'ExecuteContractForm', 'ContractFundsForm', 'StakingForm'])(
        '%s never labels its submit Preview',
        (name) => {
            expect(read(name)).not.toMatch(/'Preview'|common\.preview/);
        },
    );

    it('ContractsList drops the literal plus from Publish contract', () => {
        expect(read('ContractsList')).not.toMatch(/\+ Publish contract/);
    });
});

describe('action forms open on Network, then From (U60)', () => {
    it('the From section holds the Network field, then the From address field', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/components/formStandard/FromSection.jsx'), 'utf8');
        const network = source.indexOf('<NetworkField');
        const address = source.indexOf('<AddressField');
        expect(network).toBeGreaterThan(-1);
        expect(address).toBeGreaterThan(network);
    });

    // The From section comes first in the frame, ahead of the form's own sections.
    it.each([
        ['DispenserForm', '<FromSection', '<FormSection id="dispenser"'],
        // The target (the contract, or the network on Stake On) is the main
        // section's first field.
        ['ExecuteContractForm', '<FromSection', "title={t('execute.method')}", '<TargetField', "label={t('execute.method')}"],
        ['ContractFundsForm', '<FromSection', '<FormSection', '<TargetField', 'label="Token"'],
        // The one Staking form: the action control first (ruling 2026-11-13),
        // then Stake On, then each action's own fields (Mode, Token, Amount,
        // the signing key).
        ['StakingForm', '<FromSection', '<FormSection', '{toggle}', '<TargetField', 'label="Mode"', 'label="Token"', '<AmountField', 'label={cfg.key.label}'],
    ])('%s orders its first fields', (name, ...markers) => {
        const body = read(name);
        const form = body.slice(body.lastIndexOf('<FormFrame')).replace(/\s+/g, ' ');
        const at = markers.map((m) => form.indexOf(m));
        at.forEach((i, k) => expect(i, `${name}: ${markers[k]} not in the form`).toBeGreaterThan(-1));
        expect([...at].sort((a, b) => a - b)).toEqual(at);
    });
});

describe('optional fields use the Optional pill (U56)', () => {
    it.each(['DispenserForm', 'DeployContractForm'])('%s writes no "(optional)" into a label', (name) => {
        expect(read(name)).not.toMatch(/label="[^"]*\(optional\)"/);
    });
});
