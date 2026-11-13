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
    ['ContractStakeForm', "\\{mode === 'stake' \\? 'Stake' : mode === 'unstake' \\? 'Unstake' : 'Delegate Key'\\}"],
];

// Pages with no form: the contract page's Call button is the one green button;
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

    it('ContractDetail draws its Call method action green with an icon', () => {
        const attrs = buttonWith(read('ContractDetail'), 'aria-label="Call method"');
        expect(attrs, 'ContractDetail: main action not found').not.toBeNull();
        expect(attrs).toMatch(/variant="success"/);
        expect(attrs).toMatch(/icon=\{/);
    });

    it.each(TITLE_BAR_ACTIONS)('%s keeps its forward action as an icon button in the title bar', (name, marker) => {
        const attrs = buttonWith(read(name), marker);
        expect(attrs, `${name}: title-bar action not found`).not.toBeNull();
        expect(attrs).toMatch(/icon=\{<Icon\.PlusIcon \/>\}/);
        expect(attrs).not.toMatch(/variant="success"/);
    });

    it('DispenserExplorer submits its search through an icon button', () => {
        const attrs = buttonWith(read('DispenserExplorer'), "aria-label=\\{searching \\? 'Searching' : 'Search'\\}");
        expect(attrs, 'DispenserExplorer: search action not found').not.toBeNull();
        expect(attrs).toMatch(/icon=\{<Icon\.SearchIcon \//);
    });

    it.each([...FORM_ACTIONS.map(([name]) => name), 'ContractDetail'])('%s greens only one button', (name) => {
        const source = read(name);
        const greens = (source.match(/variant="success"/g) || []).length + (source.match(/<FormAction\b/g) || []).length;
        expect(greens).toBe(1);
    });

    it.each(TITLE_BAR_ACTIONS.map(([name]) => name))('%s greens no button', (name) => {
        expect(read(name).match(/variant="success"/g)).toBeNull();
    });

    it.each(['DispenserForm', 'DeployContractForm', 'ExecuteContractForm', 'ContractFundsForm', 'ContractStakeForm'])(
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
        ['ExecuteContractForm', '<FromSection', "title={t('execute.method')}"],
        ['ContractStakeForm', '<FromSection', '<FormSection', '>Target</dt>'],
        ['ContractFundsForm', '<FromSection', '<FormSection', 'label="Token"'],
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
