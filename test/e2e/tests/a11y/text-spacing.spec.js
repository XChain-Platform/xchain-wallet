// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    createWallet,
    expect,
    gotoSection,
    openSettings,
    test,
} from '../../fixtures/wallet.js';
import { clippedTextContainers } from '../../fixtures/textSpacing.js';

const textSpacingCss = readFileSync(
    fileURLToPath(new URL('../../fixtures/text-spacing.css', import.meta.url)),
    'utf8',
);

async function expectTextSpacingReflow(page, route) {
    await page.addStyleTag({ content: textSpacingCss });
    await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    const offenders = await page.evaluate(clippedTextContainers);
    expect(offenders, `${route}: text is clipped after applying WCAG 1.4.12 spacing`).toEqual([]);
}

test.describe('WCAG 1.4.12 text spacing', () => {
    test('Home, Send, Receive, and Settings reflow without clipped text', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 360, height: 640 });
        await createWallet(page, { password: 'textspacingpassword' });

        await expectTextSpacingReflow(page, 'Home');

        await gotoSection(page, 'Send');
        await expect(page.getByLabel('To', { exact: true })).toBeVisible();
        await expectTextSpacingReflow(page, 'Send');

        await gotoSection(page, 'Receive');
        await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible();
        await expectTextSpacingReflow(page, 'Receive');

        await openSettings(page);
        await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
        await expectTextSpacingReflow(page, 'Settings');
    });
});
