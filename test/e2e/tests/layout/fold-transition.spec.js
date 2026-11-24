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
