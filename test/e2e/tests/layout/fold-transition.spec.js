// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A fold or unfold resizes the window with a confirm open: the confirm and
// every form value must survive, and the Approve settle must re-arm.

import { bech32 } from '@scure/base';
import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { selectNamedToken } from '../../fixtures/crossChain.js';
import { loadDuoViewports } from '../../fixtures/duoMeasured.js';
import { foldPayloadFor, setNativeFold } from '../../fixtures/foldPublish.js';
import { captureFoldState } from '../../fixtures/foldCapture.js';
import { foldSurvivalFailures } from '../../fixtures/foldSurvival.js';

async function palette(page, destination, query = destination) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill(query);
    const option = dialog.getByRole('option').filter({ hasText: destination }).first();
    await expect(option, `the palette offers "${destination}"`).toBeVisible();
    await option.click();
    await expect(dialog).toBeHidden();
}

async function foldTo(page, viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setNativeFold(page, foldPayloadFor(viewport));
}

test('an open confirm and its form values survive a Duo resize and the settle re-arms', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    const [measured] = loadDuoViewports();
    const rotated = { ...measured, state: 'closed-landscape', width: measured.height, height: measured.width };

    await page.setViewportSize({ width: measured.width, height: measured.height });
    await createWallet(page);
    await setNativeFold(page, foldPayloadFor(measured));

    await palette(page, 'Create order');
    const main = page.getByRole('main');
    const chain = { chainId: 'bitcoin-mainnet', chainLabel: 'Bitcoin' };
    await selectNamedToken(page, 'Give asset', { ...chain, tick: 'XCP' });
    await selectNamedToken(page, 'Get asset', { ...chain, tick: 'PEPECASH' });
    await main.getByRole('textbox', { name: /^Give amount/ }).fill('1');
    await main.getByRole('textbox', { name: /^Get amount/ }).fill('2');
    await main.getByRole('button', { name: 'Place Order', exact: true }).click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toHaveAttribute('data-settled', 'true');

    const first = await captureFoldState(page);
    expect(first.confirmOpen).toBe(true);

    for (const target of [rotated, measured]) {
        await foldTo(page, target);
        await expect(approve).toHaveAttribute('data-settled', 'false');
        await expect(approve).toHaveAttribute('data-settled', 'true');
        const after = await captureFoldState(page);
        expect(foldSurvivalFailures(first, after)).toEqual([]);
    }
});

const CONTACT_COUNT = 16;
const DELETE_CONFIRM = { confirmSelector: '[role="dialog"][aria-labelledby]' };

function contactAddress(seed) {
    return bech32.encode('bc', [0, ...bech32.toWords(new Uint8Array(20).fill(seed))]);
}

async function addContact(page, name, seed) {
    await page.getByRole('button', { name: 'Add contact', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(contactAddress(seed));
    await page.getByRole('button', { name: 'Create contact', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Contacts' }).getByRole('button', { name, exact: true })).toBeVisible();
}

test('one Duo resize keeps form values: the contacts filter text, scroll, selected detail and open confirm', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    page.setDefaultTimeout(30 * 1000);
    const [measured] = loadDuoViewports();
    const opened = { ...measured, state: 'open-portrait', width: measured.width * 2 };
    const widened = { ...opened, width: opened.width + 24 };

    await page.setViewportSize({ width: opened.width, height: opened.height });
    await createWallet(page);
    await setNativeFold(page, foldPayloadFor(opened));
    await palette(page, 'Contacts');

    for (let i = 1; i <= CONTACT_COUNT; i += 1) await addContact(page, `Fold ${String(i).padStart(2, '0')}`, i);

    const confirm = page.getByRole('dialog', { name: 'Delete Fold 12 from contacts?' });
    const list = page.getByRole('list', { name: 'Contacts' });
    const listRegion = page.locator('[data-list-detail] > div:not([role]) > [role="region"]');
    await page.getByRole('button', { name: 'Filter contacts', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search contacts' });
    await search.fill('Fold');
    await expect(search).toHaveValue('Fold');
    await page.keyboard.press('Escape');

    const target = list.getByRole('button', { name: 'Fold 12', exact: true });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(page.getByRole('region', { name: 'Fold 12', exact: true })).toBeVisible();
    await page.getByRole('list', { name: 'Contact actions' }).getByRole('button', { name: /^Delete\b/ }).click();
    await expect(confirm).toBeVisible();

    const before = await captureFoldState(page, DELETE_CONFIRM);
    expect(before.scrollTop, `contacts list scrolled away from the top (measured ${before.scrollTop})`).toBeGreaterThan(0);
    expect(before.confirmOpen).toBe(true);
    expect(before.detailKey, 'a selected contact detail').toBeTruthy();

    await foldTo(page, widened);
    await expect(confirm).toBeVisible();

    const after = await captureFoldState(page, DELETE_CONFIRM);
    expect(foldSurvivalFailures(before, after), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`).toEqual([]);
    await expect(listRegion).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toBeHidden();
    await page.getByRole('button', { name: 'Filter contacts', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search contacts' })).toHaveValue('Fold');
});
