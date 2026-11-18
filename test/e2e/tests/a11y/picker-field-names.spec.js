// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every chip-style picker must announce WHICH field it is.
//
// ChainPicker, IconSelect, NetworkField and TokenField all render their label
// as a plain <span> beside a <button>, so the label is visible but not
// ASSOCIATED. Without an explicit accessible name the button announces only
// its current selection:
// "Bitcoin · regtest, button", which says nothing about the question it answers.
//
// The unit tests next door pin each component in isolation. This one exists
// because the defect is only dangerous in SITU: the component is fine on its
// own and ambiguous when a screen carries two of them. `CrossChainSwapForm` is
// exactly that screen - "Give network" and "Get network" side by side, on the one
// control pair in the wallet where transposing them sends the money to the
// wrong chain - so the assertion that matters is made against the real form,
// not against a fixture.
//
// AXE CANNOT REPLACE THIS, which is why it is a separate spec from a11y.spec.js:
// the buttons all HAVE accessible names, so `button-name` passes either way.
// What is being checked is whether the name identifies the field, and no static
// rule knows that "Bitcoin · regtest" fails to identify a control called
// Network. The dev-server venue is enough here: this is a rendering property,
// so it needs no chain, no funds and no signing.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

const PASSWORD = 'a11y-picker-names';

/** Opens a route through the wallet menu, by clicking its row. */
async function gotoPalette(page, title, heading = title, form = heading) {
    // The palette is modal, and a route rendered by the PREVIOUS call may still
    // be settling. Address the palette's own combobox by its dialog rather than
    // taking the first combobox on the page, or a form's own select is matched
    // and `fill` waits forever on something that is not the palette.
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(dialog, 'the wallet menu is not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);

    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: heading, exact: true }),
        `the ${title} route did not finish navigating`)
        .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('form', { name: form, exact: true }),
        `the ${title} route did not finish loading`)
        .toBeVisible({ timeout: 30_000 });
}

// A picker trigger opens a listbox (ChainPicker, IconSelect) or, for a
// Network field, the full network-picker screen (NetworkField, ruling U59).
const PICKER_TRIGGERS = 'button[aria-haspopup="listbox"], button[aria-haspopup="dialog"]';

/**
 * Every chip-style picker in the named form, as {name} rows.
 *
 * Found by the popup role rather than by class: these triggers are the buttons
 * that open a choice of values, which is precisely the set that has to name its
 * field. Scoped to the form so header menus and dialogs are not counted.
 */
async function pickers(page, form) {
    const buttons = page.getByRole('form', { name: form, exact: true }).locator(PICKER_TRIGGERS);
    await expect(buttons.first()).toBeVisible({ timeout: 30_000 });
    return readNames(buttons);
}

/** The same, but returns [] on a form that mounts none. */
async function pickersIfAny(page, form) {
    const buttons = page.getByRole('form', { name: form, exact: true }).locator(PICKER_TRIGGERS);
    if (await buttons.count() === 0) return [];
    return readNames(buttons);
}

// The name a screen reader reads: the control's own label, or, for a select
// whose field label sits outside it, "<field label>: <selection>".
async function readNames(buttons) {
    return buttons.evaluateAll((els) => els.map((b) => {
        const own = b.getAttribute('aria-label');
        if (own) return { name: own };
        const text = (b.textContent || '').trim();
        const label = (b.labels && b.labels[0] ? b.labels[0].textContent : '').trim();
        return { name: label ? `${label}: ${text}` : text };
    }));
}

test.describe('a11y: chip pickers name the field they answer for', () => {
    test('a cross-chain swap distinguishes its two chain pickers', async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await gotoPalette(page, 'Cross-chain swap', 'Cross-Chain Swap', 'Cross-chain swap');

        // The swap's two sides are token pickers, one per side. Each must say
        // which side it answers for, or a screen reader user cannot tell them apart.
        const form = page.getByRole('form', { name: 'Cross-chain swap', exact: true });
        const give = form.getByRole('button', { name: /^Give token:/ });
        const get = form.getByRole('button', { name: /^Get token:/ });
        await expect(give, 'no picker announced itself as the give-side field').toBeVisible();
        await expect(get, 'no picker announced itself as the get-side field').toBeVisible();

        // And they must be DISTINCT, which is the whole point: two identical
        // names is the bug, whatever those names happen to be.
        expect(await give.getAttribute('aria-label')).not.toBe(await get.getAttribute('aria-label'));
    });

    test('no picker anywhere announces only its selection', async ({ page }) => {
        await createWallet(page, { password: PASSWORD });

        // Routes are CANDIDATES, not requirements. Not every money-moving form
        // mounts one of these: Send, for instance, uses a token chip and an
        // asset switcher, both of which already carry explicit labels ("Token:
        // BTC on Bitcoin", "Change asset (currently Bitcoin)"). Asserting a
        // picker must exist on a named route would fail the day a form is
        // redesigned, which tests a layout decision rather than the contract.
        // The vacuity guard is the TOTAL below.
        // Titles are the palette's OWN strings; Sign message is the wallet
        // menu row's label, and a wrong title fails as "no palette command
        // matching", not as a picker problem.
        const routes = [
            ['Cross-chain swap', 'Cross-Chain Swap', 'Cross-chain swap'],
            ['Airdrop', 'Airdrop Tokens', 'Token airdrop'],
            ['Sign message', 'Sign Message', 'Sign message'],
            ['Verify signature', 'Verify Signature', 'Verify Signature'],
            ['Send', 'Send', 'Send'],
        ];
        const checked = [];

        for (const [route, heading, form] of routes) {
            await gotoPalette(page, route, heading, form);
            for (const { name } of await pickersIfAny(page, form)) {
                checked.push(`${route}: ${name}`);
                // The contract: "<field>: <selection>". A name with no colon is
                // a name made of the selection alone, which is the defect.
                expect(name, `on ${route}, a picker announces only "${name}"`)
                    .toMatch(/^[^:]+: .+/);
                // Guard the obvious wrong fix in the other direction.
                expect(name, `on ${route}, a picker announces "${name}"`)
                    .not.toMatch(/undefined|null/);
            }
        }

        // Without this the loop above passes on a build where every picker
        // vanished, or where the locator stopped matching.
        expect(checked.length, 'no picker was found on any route, so this asserted nothing')
            .toBeGreaterThan(0);
        // eslint-disable-next-line no-console
        console.log(`picker names checked:\n  ${checked.join('\n  ')}`);
    });
});
