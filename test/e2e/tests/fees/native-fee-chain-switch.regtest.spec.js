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
// `useNativeFee` forces the flag on and FeeSection shows the same switch on and
// locked (wallet UI ruling U55). A fee-bearing action composed on LTC/DOGE
// without the coin output indexes `invalid: insufficient fee (native coin
// output required)` AFTER paying a real miner fee - the expensive kind of wrong.
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

import {
    createWallet, expect, openFormSection, openPaletteCommand, revealChainPicker, test,
} from '../../fixtures/wallet.js';
import { switchToRegtest } from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';

/** The row as a CHOICE: Bitcoin, where an XCHAIN balance can pay the fee. */
const CHOICE_LABEL = /^Pay protocol fee in BTC\b/;
/**
 * The row as a LOCKED switch: off Bitcoin, where the coin output is the only
 * lane, FeeSection's pay-in-coin switch reads "Pay protocol fee in LTC", on and
 * disabled (ruling U55; pinned by FeeSection.test.jsx "shows on and locked
 * where the native output is the protocol fee"). Checked AND disabled together
 * are the proof: a `mandatory` seeded at mount would leave the LTC switch
 * enabled and off.
 */
const LOCKED_LABEL = /^Pay protocol fee in LTC\b/;

/** The pay-in-coin switch for `label`, as a switch or a checkbox. */
function feeSwitch(scope, label) {
    return scope.getByRole('switch', { name: label })
        .or(scope.getByRole('checkbox', { name: label })).first();
}

/**
 * Switches the FORM's own chain picker (labelled "Network") to `chainLabel`.
 *
 * Every form carries its own picker and they do not share state (§3.5), so this
 * deliberately does not go through settings: the point is a chain change made
 * INSIDE an open form, with the form still mounted.
 *
 * The fee row (a choice on Bitcoin, locked on elsewhere) sits in the
 * Speed and Fees section, closed by default, so the section is opened after
 * every switch; an open section is left alone.
 */
async function switchFormChain(scope, chainLabel) {
    const trigger = scope.getByRole('button', { name: /^Network:/ }).first();
    await revealChainPicker(scope, trigger, 'Network');
    await trigger.click();
    await trigger.page().getByRole('dialog', { name: 'Network' })
        .getByRole('button', { name: new RegExp(`^Select ${chainLabel}\\b`) }).first().click();
    await expect(trigger, `the form did not switch to ${chainLabel}`)
        .toHaveAttribute('aria-label', new RegExp(chainLabel), { timeout: 15_000 });
    await openFormSection(scope, 'Speed and Fees');
}

test.describe('the native-fee rule when the chain changes under an open form', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('the fee row re-derives from the chain, not from where the form started', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Fee Rule Wallet' });
        await switchToRegtest(page, PASSWORD);

        await openPaletteCommand(page, 'Issue token');
        const main = page.getByRole('main');
        await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });

        await test.step('on Bitcoin the fee row is a choice, and it starts off', async () => {
            await switchFormChain(main, 'Bitcoin');

            const toggle = feeSwitch(main, CHOICE_LABEL);
            await expect(toggle, 'Bitcoin does not offer the XCHAIN-or-coin choice at all')
                .toBeVisible({ timeout: 30_000 });
            await expect(toggle, 'the Bitcoin choice is locked, so it is no choice at all')
                .toBeEnabled();
            await expect(toggle,
                'the coin lane is pre-selected on Bitcoin, where the XCHAIN balance is the default lane')
                .not.toBeChecked();
            await expect(feeSwitch(main, LOCKED_LABEL),
                'Bitcoin is being shown the Litecoin fee row').toBeHidden();
        });

        await test.step('switching the SAME form to Litecoin locks the switch on', async () => {
            // The form is not remounted: only its picker moved. A `mandatory`
            // seeded into state at mount would leave the switch enabled and
            // off here, and an action composed from it would pay a miner fee
            // to be rejected for a missing fee output (the failure).
            await switchFormChain(main, 'Litecoin');

            const locked = feeSwitch(main, LOCKED_LABEL);
            const lockedMessage = (what) => `the Litecoin fee switch is ${what}, so the fee row is not `
                + 'tracking the chain. Check the CHAIN INPUT before the hook: `useNativeFee` derives '
                + '`mandatory` per render, so a stale row means `chainId` did not move with the picker '
                + '- and check LOCKED_LABEL against FeeSection\'s `flows.protocolFee.toggleLabel`, '
                + 'because a copy change here reads exactly like a product defect';
            await expect(locked, lockedMessage('missing')).toBeVisible({ timeout: 30_000 });
            await expect(locked, lockedMessage('off')).toBeChecked();
            await expect(locked, lockedMessage('still switchable')).toBeDisabled();
            await expect(feeSwitch(main, CHOICE_LABEL),
                'the Bitcoin coin-or-XCHAIN choice is still on screen on a chain that has no XCHAIN lane')
                .toBeHidden({ timeout: 30_000 });
        });

        await test.step('and switching back restores the choice', async () => {
            // The reverse matters as much: a form that latched `mandatory` ON
            // would keep telling a Bitcoin user they have no choice, which is
            // the same defect wearing the other face.
            await switchFormChain(main, 'Bitcoin');

            const toggle = feeSwitch(main, CHOICE_LABEL);
            await expect(toggle, 'the choice did not come back on Bitcoin').toBeVisible({ timeout: 30_000 });
            await expect(feeSwitch(main, LOCKED_LABEL),
                'Bitcoin is still showing the locked Litecoin fee row').toBeHidden();
            // Litecoin's lock forces the flag without touching the opt-in, so
            // Bitcoin's default lane comes back.
            await expect(toggle, 'Bitcoin is still locked to the coin lane').toBeEnabled();
            await expect(toggle, 'the Litecoin lock leaked into Bitcoin\'s opt-in').not.toBeChecked();

            // And it is a real control, not a disabled echo of the Litecoin state.
            await toggle.click();
            await expect(toggle, 'the Bitcoin toggle cannot actually be turned on').toBeChecked();
        });
    });
});
