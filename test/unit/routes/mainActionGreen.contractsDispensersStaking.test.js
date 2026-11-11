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

/** The JSX of the first <Button> whose children end with `label`. */
function buttonFor(source, label) {
    const re = new RegExp(`<Button\\b((?:(?!<Button\\b)[\\s\\S])*?)>\\s*${label}\\s*</Button>`);
    const m = source.match(re);
    return m ? m[1] : null;
}

const MAIN_ACTIONS = [
    ['DispenserForm', 'Create dispenser'],
    ['DispenserExplorer', "\\{searching \\? 'Searching…' : 'Search'\\}"],
    ['ContractsList', 'Publish contract'],
    ['ContractDetail', 'Call method'],
    ['DeployContractForm', 'Publish contract'],
    ['ExecuteContractForm', "\\{t\\('execute\\.callContract'\\)\\}"],
    ['ContractFundsForm', '\\{verb\\}'],
    ['ContractStakeForm', "\\{mode === 'stake' \\? 'Stake' : mode === 'unstake' \\? 'Unstake' : 'Delegate key'\\}"],
    ['StakingList', 'New stake'],
];

describe('main actions on the dispenser, contract and staking screens (U63)', () => {
    it.each(MAIN_ACTIONS)('%s draws its main action green with an icon', (name, label) => {
        const attrs = buttonFor(read(name), label);
        expect(attrs, `${name}: main action not found`).not.toBeNull();
        expect(attrs).toMatch(/variant="success"/);
        expect(attrs).toMatch(/icon=\{/);
    });

    it.each(MAIN_ACTIONS.map(([name]) => name))('%s greens only one button', (name) => {
        expect(read(name).match(/variant="success"/g)).toHaveLength(1);
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
    it.each([
        ['DispenserForm', 'label="Network"', 'label="From"', 'label="Dispenser address"'],
        ['ExecuteContractForm', '<NetworkField', "label={t('execute.caller')}", "label={t('execute.method')}"],
        ['ContractStakeForm', '<NetworkField', 'label="From"', '>Target</dt>'],
        ['ContractFundsForm', '<NetworkField label="Network"', "label={isDeposit ? 'From' : 'To'}", 'label="Token"'],
    ])('%s orders its first fields', (name, ...markers) => {
        const body = read(name);
        const form = body.slice(body.lastIndexOf('<FormPage')).replace(/\s+/g, ' ');
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
