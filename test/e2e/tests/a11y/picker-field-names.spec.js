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
// ChainPicker, IconSelect and TokenField all render their label as a plain
// <span> beside a <button>, so the label is visible but not ASSOCIATED. Without
// an explicit accessible name the button announces only its current selection:
// "Bitcoin · regtest, button", which says nothing about the question it answers.
//
// The unit tests next door pin each component in isolation. This one exists
// because the defect is only dangerous in SITU: the component is fine on its
// own and ambiguous when a screen carries two of them. `CrossChainSwapForm` is
// exactly that screen - "Give chain" and "Get chain" side by side, on the one
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

/** Opens a route through the command palette, by clicking its row. */
async function gotoPalette(page, title) {
    // The palette is modal, and a route rendered by the PREVIOUS call may still
    // be settling. Address the palette's own combobox by its dialog rather than
    // taking the first combobox on the page, or a form's own select is matched
    // and `fill` waits forever on something that is not the palette.
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
 * Every chip-style picker on the current screen, as {name} rows.
 *
 * Found by the popup role rather than by class: these triggers are the buttons
 * that open a listbox, which is precisely the set that has to name its field.
 */
async function pickers(page) {
    const buttons = page.locator('button[aria-haspopup="listbox"]');
    await expect(buttons.first()).toBeVisible({ timeout: 30_000 });
    return readNames(buttons);
}

/** The same, but returns [] on a screen that mounts none. */
async function pickersIfAny(page) {
    const buttons = page.locator('button[aria-haspopup="listbox"]');
    // Let the route paint before concluding there are none; the count is read
    // after a settle rather than immediately, or a slow mount reads as absence.
    await page.waitForTimeout(500);
    if (await buttons.count() === 0) return [];
    return readNames(buttons);
}

async function readNames(buttons) {
    return Promise.all((await buttons.all()).map(async (b) => ({
        name: (await b.getAttribute('aria-label'))
            || (await b.textContent() || '').trim(),
    })));
}

test.describe('a11y: chip pickers name the field they answer for', () => {
    test('a cross-chain swap distinguishes its two chain pickers', async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await gotoPalette(page, 'Cross-chain swap');

        const found = await pickers(page);
        const names = found.map((p) => p.name);

        // The specific pair this defect was found for. Before the fix both of
        // these announced as the chain they were showing, so a screen reader
        // user could not tell which side of the swap they were editing.
        expect(names.some((n) => /^Give chain:/.test(n)),
            `no picker announced itself as the give-chain field; saw ${JSON.stringify(names)}`)
            .toBe(true);
        expect(names.some((n) => /^Get chain:/.test(n)),
            `no picker announced itself as the get-chain field; saw ${JSON.stringify(names)}`)
            .toBe(true);

        // And they must be DISTINCT, which is the whole point: two identical
        // names is the bug, whatever those names happen to be.
        const give = names.find((n) => /^Give chain:/.test(n));
        const get = names.find((n) => /^Get chain:/.test(n));
        expect(give).not.toBe(get);
    });

    test('no listbox picker anywhere announces only its selection', async ({ page }) => {
        await createWallet(page, { password: PASSWORD });

        // Routes are CANDIDATES, not requirements. Not every money-moving form
        // mounts one of these: Send, for instance, uses a token chip and an
        // asset switcher, both of which already carry explicit labels ("Token:
        // BTC on Bitcoin", "Change asset (currently Bitcoin)"). Asserting a
        // picker must exist on a named route would fail the day a form is
        // redesigned, which tests a layout decision rather than the contract.
        // The vacuity guard is the TOTAL below.
        // Titles are the palette's OWN strings; "Sign message" is not one of
        // them ("Sign a message" is), and a wrong title fails as "no palette
        // command matching", not as a picker problem.
        const routes = ['Cross-chain swap', 'Airdrop', 'Sign a message', 'Verify a signature', 'Send'];
        const checked = [];

        for (const route of routes) {
            await gotoPalette(page, route);
            for (const { name } of await pickersIfAny(page)) {
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
        expect(checked.length, 'no listbox picker was found on any route, so this asserted nothing')
            .toBeGreaterThan(0);
        // eslint-disable-next-line no-console
        console.log(`picker names checked:\n  ${checked.join('\n  ')}`);
    });
});
