// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    readRecoveryPhrase,
    test,
} from '../../fixtures/wallet.js';
import { measureInPage } from '../../layout/sweep.js';

const PASSWORD = 'responsive-onboarding-1234';
const VIEWPORTS = [
    { name: 'phone portrait', width: 320, height: 568 },
    { name: 'phone landscape', width: 740, height: 360 },
];

async function expectReachableLayout(page, label, action) {
    await action.scrollIntoViewIfNeeded();
    await expect(action, `${label}: primary action is not reachable`).toBeVisible();

    const actionBox = await action.boundingBox();
    const viewport = page.viewportSize();
    expect(actionBox, `${label}: primary action has no rendered box`).not.toBeNull();
    expect(actionBox.x, `${label}: primary action starts outside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(actionBox.x + actionBox.width, `${label}: primary action ends outside the viewport`).toBeLessThanOrEqual(viewport.width + 1);
    expect(actionBox.y, `${label}: primary action starts above the viewport`).toBeGreaterThanOrEqual(-1);
    expect(actionBox.y + actionBox.height, `${label}: primary action ends below the viewport`).toBeLessThanOrEqual(viewport.height + 1);

    const report = await page.evaluate(measureInPage);
    expect(report.pageScrollX, `${label}: document scrolls horizontally`).toBe(0);
    expect(report.xScrollers, `${label}: nested content scrolls horizontally`).toEqual([]);
    expect(report.offscreen, `${label}: content paints outside the viewport`).toEqual([]);
    expect(report.clipped, `${label}: content is clipped`).toEqual([]);

    const clippedLabels = await page.evaluate(() => {
        const result = [];
        const nodes = document.querySelectorAll('label, button, button *');
        for (const node of nodes) {
            const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
            if (!text) continue;
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (node.scrollWidth <= node.clientWidth + 1) continue;
            if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') continue;
            result.push({ text: text.slice(0, 80), hiddenBy: style.overflowX });
        }
        return result;
    });
    expect(clippedLabels, `${label}: a control label is clipped`).toEqual([]);
}

async function expectReadablePhraseGrid(page, label) {
    const cells = await page.getByRole('list', { name: 'Recovery phrase' }).evaluate((grid) => {
        const gridBox = grid.getBoundingClientRect();
        return [...grid.querySelectorAll('li')].map((cell) => {
            const cellBox = cell.getBoundingClientRect();
            const word = cell.lastElementChild;
            const wordBox = word.getBoundingClientRect();
            return {
                name: cell.getAttribute('aria-label'),
                fontSize: parseFloat(getComputedStyle(word).fontSize),
                insideGrid: cellBox.left >= gridBox.left - 1 && cellBox.right <= gridBox.right + 1,
                insideCell: wordBox.left >= cellBox.left - 1 && wordBox.right <= cellBox.right + 1,
            };
        });
    });

    expect(cells.length, `${label}: phrase grid has no words`).toBeGreaterThan(0);
    for (const cell of cells) {
        expect(cell.fontSize, `${label}: ${cell.name} is too small to read`).toBeGreaterThanOrEqual(12);
        expect(cell.insideGrid, `${label}: ${cell.name} leaves the phrase grid`).toBe(true);
        expect(cell.insideCell, `${label}: ${cell.name} is clipped by its cell`).toBe(true);
    }
}

async function returnToWelcome(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
}

for (const viewport of VIEWPORTS) {
    test(`onboarding renders every step at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await returnToWelcome(page);

        await expectReachableLayout(
            page,
            `${viewport.name} welcome/create`,
            page.getByRole('button', { name: 'Create new wallet' }),
        );
        await expectReachableLayout(
            page,
            `${viewport.name} demo`,
            page.getByRole('button', { name: 'Try in demo mode' }),
        );

        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await expectReachableLayout(
            page,
            `${viewport.name} create/password`,
            page.getByRole('button', { name: 'Next' }),
        );
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
        await page.getByRole('button', { name: 'Next' }).click();

        // readRecoveryPhrase asserts the stage opens concealed, then reveals it.
        const words = await readRecoveryPhrase(page);
        await expectReachableLayout(
            page,
            `${viewport.name} phrase`,
            page.getByRole('button', { name: 'Verify recovery phrase' }),
        );
        await expectReadablePhraseGrid(page, `${viewport.name} phrase`);
        expect(words).toHaveLength(12);
        await page.getByLabel(/written down|saved my recovery phrase/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();

        await expectReachableLayout(
            page,
            `${viewport.name} confirm`,
            page.getByRole('button', { name: 'Create wallet' }),
        );

        await returnToWelcome(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();
        await expectReachableLayout(
            page,
            `${viewport.name} recovery phrase import`,
            page.getByRole('button', { name: 'Import', exact: true }),
        );
        await page.getByRole('tab', { name: 'Encrypted backup' }).click();
        await expectReachableLayout(
            page,
            `${viewport.name} encrypted backup import`,
            page.getByRole('button', { name: 'Restore', exact: true }),
        );

        await returnToWelcome(page);
        await page.getByRole('button', { name: 'From FreeWallet' }).click();
        await expectReachableLayout(
            page,
            `${viewport.name} FreeWallet import`,
            page.getByRole('button', { name: 'Import', exact: true }),
        );
    });
}
