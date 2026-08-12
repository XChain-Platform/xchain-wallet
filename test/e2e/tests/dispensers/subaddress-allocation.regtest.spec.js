// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LIVE regtest verification of the dispenser SUB-ADDRESS flow.
//
// WHAT WAS ACTUALLY UNCOVERED, and why the neighbouring spec does not count.
// `buy-funding.regtest.spec.js` drives dispensers, but it opens them from an
// address the fixture already funded, so it never allocates a dispenser
// sub-address at all. The allocation rule had only a unit test, and the rule is
// precisely the part that changed: dispensers USED to be quarantined on
// change=2, and the current model (dispenserAddress.js) puts them on the
// external change=0 chain with `role` as local metadata. That change exists so a
// seed-only restore into any BIP44 wallet rediscovers them and their funds, so a
// regression would not surface as a broken screen. It would surface, silently,
// as money that a restore cannot find.
//
// WHAT THIS PINS, against a real wallet and a real derivation:
//   1. a dispenser address derives on change=0, NOT the retired change=2;
//   2. it shares ONE contiguous index space with receive addresses, so it lands
//      one past the highest change=0 index across ALL roles, never colliding
//      with a receive address and never leaving a gap.
//
// The index space is the assertion that matters. A dispenser that quietly
// restarted its own numbering would still look right on screen and would still
// receive funds; it would collide with a receive address derived later, and the
// collision stays invisible until two labels resolve to one key.
//
// Addresses are identified by SET DIFFERENCE across a generate, not by "the
// last row": the list sorts for the reader, not for this spec, and onboarding
// has already put an address in it before the first step runs.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { switchToRegtest } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

/** Every address currently listed, by the row's own aria-label. */
async function listedAddresses(page) {
    const rows = page.getByRole('button', { name: /^View address / });
    await expect(rows.first(), 'the Addresses page listed nothing at all').toBeVisible({ timeout: 60_000 });
    const names = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    return new Set(names);
}

/**
 * The BIP44 change and address index out of a derivation path.
 *
 * Positional from the END rather than a full m/44'/c'/a'/x/i match: the coin and
 * account segments differ per chain and per account, and this spec has an
 * opinion about the last two only.
 */
function pathTail(derivationPath) {
    const parts = String(derivationPath).trim().split('/');
    return { change: Number(parts.at(-2)), index: Number(parts.at(-1)) };
}

async function openAddresses(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill('Addresses');
    await page.getByRole('option', { name: /^Addresses\b/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Generates one address of `purpose` and returns its row aria-label.
 *
 * The add control lives in the page header's trailing slot, not in <main>.
 */
async function generateAddress(page, purpose) {
    const before = await listedAddresses(page);

    await page.getByTestId('address-add-menu').click();
    await page.getByTestId('address-add-address').click();
    await expect(page.getByTestId('add-address-generate'),
        'the Add addresses screen did not open').toBeVisible({ timeout: 30_000 });

    if (purpose === 'dispenser') {
        // Rendered only when the host exposes generateDispenserAddress. If it is
        // missing the flow cannot be driven at all, which is a fact about the
        // build under test rather than a selector problem, so name it as such.
        const select = page.getByTestId('add-address-purpose');
        await expect(select,
            'the Add addresses screen offers no Purpose selector, so this build cannot create a '
            + 'dispenser sub-address (messaging.generateDispenserAddress is missing)')
            .toBeVisible({ timeout: 30_000 });
        await select.selectOption('dispenser');
    }

    await page.getByTestId('add-address-generate').click();

    let added = [];
    await expect(async () => {
        const after = await listedAddresses(page);
        added = [...after].filter((a) => !before.has(a));
        expect(added, `generating a ${purpose} address added no new row`).toHaveLength(1);
    }).toPass({ timeout: 60_000 });

    return added[0];
}

/** The derivation path the wallet SHOWS for `rowName`, read through the detail view. */
async function readPath(page, rowName) {
    await page.getByRole('button', { name: rowName, exact: true }).click();

    const field = page.getByTestId('address-detail-derivation-path');
    await expect(field, 'the address detail view showed no derivation path').toBeVisible({ timeout: 30_000 });
    const value = (await field.innerText()).trim();

    await page.getByRole('button', { name: 'Back' }).first().click();
    await expect(page.getByRole('button', { name: /^View address / }).first())
        .toBeVisible({ timeout: 30_000 });
    return pathTail(value);
}

test.describe('dispenser sub-address allocation on regtest', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a dispenser derives on change=0 and shares one index space with receive addresses', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Dispenser Subaddress Wallet' });
        await switchToRegtest(page, PASSWORD);
        await openAddresses(page);

        let receive;

        await test.step('a receive address takes the next external index', async () => {
            const row = await generateAddress(page, 'receive');
            receive = await readPath(page, row);
            expect(receive.change, 'a receive address must derive on the external chain').toBe(0);
        });

        await test.step('a dispenser takes the NEXT index on that same chain, not a branch of its own', async () => {
            const row = await generateAddress(page, 'dispenser');

            // PROVE THE ROLE TOOK, before trusting anything downstream of it.
            // Every other assertion here is equally true of a receive address, so
            // if `selectOption` silently no-opped this spec would pass while
            // testing nothing at all. The default dispenser label is the only
            // role signal the list surfaces, dispenser-ness being metadata rather
            // than a path segment.
            await expect(page.getByRole('button', { name: row, exact: true }),
                'the generated address is not tagged as a dispenser, so the Purpose selection did not '
                + 'take and the rest of this test would be asserting about a plain receive address')
                .toContainText(/Dispenser/i, { timeout: 30_000 });

            const dispenser = await readPath(page, row);

            expect(dispenser.change,
                'the dispenser derived off the external chain; change=2 is the RETIRED design and a '
                + 'seed-only BIP44 restore would not rediscover it').toBe(0);
            expect(dispenser.index,
                'the dispenser did not take the next contiguous index, so the two roles are numbering '
                + 'independently and will eventually derive the same key twice')
                .toBe(receive.index + 1);
        });
    });
});
