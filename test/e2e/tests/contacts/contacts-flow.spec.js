// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const PASSWORD = 'contacts-flow-pass-1234';
const CONTACT_NAME = 'E2E Ada';
const EDITED_NAME = 'E2E Ada Edited';
const CONTACT_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

function contactRow(page, name) {
    return page.getByRole('list', { name: 'Contacts' })
        .getByRole('button', { name, exact: true });
}

async function settleLayout(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, label) {
    await settleLayout(page);
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document scrolls sideways (${scrollWidth}px in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

/**
 * Filters the contact list to one network. On the Contacts page the network
 * filter sits inside the Filter contacts panel; Send's address-book picker
 * shows it on the screen itself. Either opens the full-screen network list,
 * and the panel is closed again so the filtered list is what the next step reads.
 */
async function pickContactNetwork(page, network) {
    const panel = page.getByRole('dialog', { name: 'Filter contacts' });
    const direct = page.getByRole('main').getByRole('button', { name: /^Filter by network/ });
    const openPanel = page.getByRole('button', { name: 'Filter contacts', exact: true });
    await expect(direct.or(openPanel).or(panel).first()).toBeVisible();
    if (!(await direct.isVisible()) && !(await panel.isVisible())) await openPanel.click();
    const filter = (await panel.isVisible())
        ? panel.getByRole('button', { name: /^Filter by network/ })
        : direct;
    await filter.click();
    await page.getByRole('dialog', { name: 'Network' })
        .getByRole('button', { name: `Select ${network}`, exact: true }).click();
    if (await panel.isVisible()) await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
}

for (const viewport of VIEWPORTS) {
    test(`contact CRUD and Send recipient picking fit the ${viewport.name} viewport`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await createWallet(page, { password: PASSWORD });

        await test.step('add and edit a Bitcoin contact', async () => {
            await gotoSection(page, 'Contacts');
            await page.getByRole('button', { name: 'Add contact', exact: true }).click();
            await page.getByRole('textbox', { name: 'Name', exact: true }).fill(CONTACT_NAME);
            await page.getByRole('textbox', { name: 'Address', exact: true }).fill(CONTACT_ADDRESS);
            await page.getByRole('button', { name: 'Create contact', exact: true }).click();

            await expect(contactRow(page, CONTACT_NAME)).toBeVisible();
            await contactRow(page, CONTACT_NAME).click();
            // The contact's actions are an action list (G101); a row's name
            // carries its description, so it is matched by its leading title.
            const actions = page.getByRole('list', { name: 'Contact actions' });
            await actions.getByRole('button', { name: /^Edit\b/ }).click();
            await page.getByRole('textbox', { name: 'Name', exact: true }).fill(EDITED_NAME);
            await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Primary Bitcoin recipient');
            await page.getByRole('button', { name: 'Update Contact', exact: true }).click();

            // A phone shows the contact on its own View Contact screen; a wide
            // screen shows it in the detail panel beside the list, named by the contact.
            await expect(page.getByRole('heading', { name: 'View Contact' })
                .or(page.getByRole('region', { name: EDITED_NAME, exact: true })).first()).toBeVisible();
            await expect(page.getByRole('main').getByText(EDITED_NAME, { exact: true }).first()).toBeVisible();
            await expectNoHorizontalOverflow(page, `${viewport.name} edited contact`);
            const back = page.getByRole('button', { name: 'Back to previous screen' });
            if (await back.isVisible()) await back.click();
            await expect(contactRow(page, EDITED_NAME)).toBeVisible();
        });

        await test.step('filter contacts by network', async () => {
            await pickContactNetwork(page, 'Litecoin');
            await expect(contactRow(page, EDITED_NAME)).toHaveCount(0);
            await expect(page.getByText('No results for these filters', { exact: true })).toBeVisible();

            await pickContactNetwork(page, 'Bitcoin');
            await expect(contactRow(page, EDITED_NAME)).toBeVisible();
            await expectNoHorizontalOverflow(page, `${viewport.name} filtered contacts`);
        });

        await test.step('pick the contact from Send on the Bitcoin chain', async () => {
            await gotoSection(page, 'Send');
            const bitcoinAsset = page.getByRole('button', {
                name: 'Asset: BTC on Bitcoin',
            });
            await expect(bitcoinAsset).toBeVisible();
            await page.getByRole('button', { name: 'Open address book' }).click();
            await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
            await pickContactNetwork(page, 'Bitcoin');
            await expectNoHorizontalOverflow(page, `${viewport.name} Send contacts picker`);

            const pickerRow = page.getByRole('main').getByRole('button')
                .filter({ hasText: EDITED_NAME });
            await expect(pickerRow).toHaveCount(1);
            await pickerRow.click();

            // A picked contact joins the field label, so the name reads "To <contact>".
            await expect(page.getByRole('combobox', { name: `To ${EDITED_NAME}`, exact: true }))
                .toHaveValue(CONTACT_ADDRESS);
            await expect(bitcoinAsset).toBeVisible();
            await expect(page.getByText(EDITED_NAME, { exact: true })).toBeVisible();
            await expectNoHorizontalOverflow(page, `${viewport.name} populated Send form`);
        });

        await test.step('delete the contact', async () => {
            await gotoSection(page, 'Contacts');
            await contactRow(page, EDITED_NAME).click();
            await page.getByRole('list', { name: 'Contact actions' })
                .getByRole('button', { name: /^Delete\b/ }).click();

            const dialog = page.getByRole('dialog', {
                name: `Delete ${EDITED_NAME} from contacts?`,
            });
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: 'Delete contact', exact: true }).click();

            await expect(contactRow(page, EDITED_NAME)).toHaveCount(0);
            await expect(page.getByText('No contacts yet', { exact: true })).toBeVisible();
            await expectNoHorizontalOverflow(page, `${viewport.name} empty contacts list`);
        });
    });
}
