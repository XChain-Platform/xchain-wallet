// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.4's owed half: the mandatory rule when the CHAIN CHANGES
// under a form that is already open.
//
// WHAT THE RULE IS. On Bitcoin the protocol fee can be paid from an XCHAIN
// balance, so paying it in coin is a CHOICE and the row is a toggle. Off
// Bitcoin there is no XCHAIN lane at all: the native-coin output IS the fee, so
// `useNativeFee` forces the flag on and the row becomes a statement. Before
// A fee-bearing action composed on LTC/DOGE from the default state
// indexed `invalid: insufficient fee (native coin output required)` AFTER
// paying a real miner fee - the expensive kind of wrong.
//
// WHY THE CHAIN-SWITCH CASE SPECIFICALLY. `mandatory` is derived per render
// rather than seeded into state, precisely so that switching the form's chain
// re-derives it. That is a deliberate design decision with no visible symptom
// when it is right and a money-losing one when it is wrong, which is exactly
// the kind of thing that survives a refactor unnoticed. Session 22 proved the
// LTC path end to end (ISSUE indexed valid with a real coin fee output); what
// was never driven is the TRANSITION, and a form seeded from its initial chain
// would pass every single-chain test ever written.
//
// NOTHING IS BROADCAST HERE, deliberately: the assertion is about what the form
// derives, so the run needs no funding, no XCHAIN, no oracle price and no
// blocks. It is the cheapest spec in the betting/fees family and it covers the
// one transition none of the others touch.
//
// The venue chain is irrelevant to this spec - it drives Bitcoin and Litecoin
// by name because the rule is about the difference between them - so it runs
// under the default XC_REGTEST_COIN.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { switchToRegtest } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

/** The row as a CHOICE: Bitcoin, where an XCHAIN balance can pay the fee. */
const CHOICE_LABEL = /^Pay protocol fee in BTC instead of XCHAIN/;
/** The row as a STATEMENT: off Bitcoin, where the coin output is the only lane. */
const STATEMENT_TEXT = /LTC is the only way to pay the protocol fee on this chain/;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Switches the FORM's own chain picker (labelled "Network") to `chainLabel`.
 *
 * Every form carries its own picker and they do not share state (§3.5), so this
 * deliberately does not go through settings: the point is a chain change made
 * INSIDE an open form, with the form still mounted.
 */
async function switchFormChain(scope, chainLabel) {
    const trigger = scope.getByRole('button', { name: /^Network:/ }).first();
    await expect(trigger, 'this form has no "Network" chain picker').toBeVisible({ timeout: 30_000 });
    await trigger.click();
    await scope.getByRole('option', { name: new RegExp(`^${chainLabel}\\b`) }).first().click();
    await expect(trigger, `the form did not switch to ${chainLabel}`)
        .toHaveAttribute('aria-label', new RegExp(chainLabel), { timeout: 15_000 });
}

test.describe('the native-fee rule when the chain changes under an open form', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('the fee row re-derives from the chain, not from where the form started', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Fee Rule Wallet' });
        await switchToRegtest(page, PASSWORD);

        await gotoPalette(page, 'Issue token');
        const main = page.getByRole('main');
        await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });

        await test.step('on Bitcoin the fee row is a choice, and it starts off', async () => {
            await switchFormChain(main, 'Bitcoin');

            const toggle = main.getByRole('switch', { name: CHOICE_LABEL })
                .or(main.getByRole('checkbox', { name: CHOICE_LABEL })).first();
            await expect(toggle, 'Bitcoin does not offer the XCHAIN-or-coin choice at all')
                .toBeVisible({ timeout: 30_000 });
            await expect(toggle,
                'the coin lane is pre-selected on Bitcoin, where the XCHAIN balance is the default lane')
                .not.toBeChecked();
            await expect(main.getByText(STATEMENT_TEXT),
                'Bitcoin is being told it has no choice').toBeHidden();
        });

        await test.step('switching the SAME form to Litecoin turns the choice into a statement', async () => {
            // The form is not remounted: only its picker moved. A `mandatory`
            // seeded into state at mount would leave the Bitcoin toggle on
            // screen here, and an action composed from it would pay a miner fee
            // to be rejected for a missing fee output (the failure).
            await switchFormChain(main, 'Litecoin');

            await expect(main.getByText(STATEMENT_TEXT),
                'the form still offers Bitcoin\'s choice after switching to Litecoin: `mandatory` was '
                + 'seeded at mount instead of derived per render')
                .toBeVisible({ timeout: 30_000 });
            await expect(main.getByRole('switch', { name: CHOICE_LABEL })
                .or(main.getByRole('checkbox', { name: CHOICE_LABEL })).first(),
            'the coin-or-XCHAIN choice is still switchable on a chain that has no XCHAIN lane')
                .toBeHidden({ timeout: 30_000 });
        });

        await test.step('and switching back restores the choice', async () => {
            // The reverse matters as much: a form that latched `mandatory` ON
            // would keep telling a Bitcoin user they have no choice, which is
            // the same defect wearing the other face.
            await switchFormChain(main, 'Bitcoin');

            const toggle = main.getByRole('switch', { name: CHOICE_LABEL })
                .or(main.getByRole('checkbox', { name: CHOICE_LABEL })).first();
            await expect(toggle, 'the choice did not come back on Bitcoin').toBeVisible({ timeout: 30_000 });
            await expect(main.getByText(STATEMENT_TEXT),
                'Bitcoin is still being told the coin is its only lane').toBeHidden();

            // And it is a real control, not a disabled echo of the Litecoin state.
            await toggle.click();
            await expect(toggle, 'the Bitcoin toggle cannot actually be turned on').toBeChecked();
        });
    });
});
