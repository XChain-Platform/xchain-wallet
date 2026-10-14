// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
];

const TEMPLATE_NAMES = [
    'Meme token',
    'Utility token',
    'Collectible',
    'Limited edition',
    'Subtoken',
    'Custom',
];

const MAX_OFFSET_PX = 1;

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function openCreateToken(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Create a token');
    await palette.getByRole('option', { name: /^Create a token\b/ }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByText('Step 1 of 4: Template', { exact: true })).toBeVisible();
}

async function cardMetrics(page) {
    const main = page.getByRole('main');
    const templateList = main.getByRole('list').filter({ hasText: 'Meme token' });
    const cards = templateList.locator(':scope > li > button');
    await expect(cards).toHaveCount(TEMPLATE_NAMES.length);

    const metrics = [];
    for (let index = 0; index < TEMPLATE_NAMES.length; index += 1) {
        const name = TEMPLATE_NAMES[index];
        const card = cards.nth(index);
        const title = card.getByText(name, { exact: true });
        await expect(card, `${name} card is not visible`).toBeVisible();
        await expect(title, `${name} title is not visible`).toBeVisible();

        metrics.push(await card.evaluate((element, titleText) => {
            const titleElement = [...element.querySelectorAll('span')]
                .find((candidate) => candidate.textContent === titleText);
            if (!titleElement) throw new Error(`No title element for ${titleText}`);

            const cardBox = element.getBoundingClientRect();
            const titleBox = titleElement.getBoundingClientRect();
            const style = getComputedStyle(element);
            const titleStyle = getComputedStyle(titleElement);
            return {
                name: titleText,
                top: cardBox.top,
                height: cardBox.height,
                titleInset: titleBox.left - cardBox.left,
                titleColor: titleStyle.color,
                backgroundColor: style.backgroundColor,
                borders: ['Top', 'Right', 'Bottom', 'Left'].map((side) => ({
                    side: side.toLowerCase(),
                    width: parseFloat(style[`border${side}Width`]),
                    style: style[`border${side}Style`],
                    color: style[`border${side}Color`],
                })),
            };
        }, name));
    }

    const linkColor = await page.evaluate(() => {
        const probe = document.createElement('a');
        probe.href = '#link-colour-probe';
        probe.textContent = 'link colour probe';
        probe.style.position = 'fixed';
        probe.style.visibility = 'hidden';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });

    return { linkColor, metrics };
}

function rowsFor(metrics) {
    const rows = [];
    for (const metric of [...metrics].sort((a, b) => a.top - b.top)) {
        const row = rows.find(
            (candidate) => Math.abs(candidate[0].top - metric.top) <= MAX_OFFSET_PX,
        );
        if (row) row.push(metric);
        else rows.push([metric]);
    }
    return rows;
}

test('Create token template cards retain their visual hierarchy in demo mode', async ({ page }) => {
    test.slow();
    await page.setViewportSize(VIEWPORTS[0]);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await openCreateToken(page);

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width} by ${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            await settle(page);

            const { linkColor, metrics } = await cardMetrics(page);
            const diagnostic = JSON.stringify({ linkColor, metrics }, null, 2);

            const borderFailures = metrics.flatMap((metric) => metric.borders
                .filter((border) => border.width <= 0
                    || border.style === 'none'
                    || border.style === 'hidden'
                    || border.color === 'transparent'
                    || border.color === 'rgba(0, 0, 0, 0)'
                    || border.color === metric.backgroundColor)
                .map((border) => `${metric.name} ${border.side}`));
            expect(
                borderFailures,
                `${viewport.width}px: every card edge must have a visible border\n${diagnostic}`,
            ).toEqual([]);

            const titleInsets = metrics.map(({ titleInset }) => titleInset);
            expect(
                Math.max(...titleInsets) - Math.min(...titleInsets),
                `${viewport.width}px: title left insets differ by more than 1px\n${diagnostic}`,
            ).toBeLessThanOrEqual(MAX_OFFSET_PX);

            const linkColouredTitles = metrics
                .filter(({ titleColor }) => titleColor === linkColor)
                .map(({ name }) => name);
            expect(
                linkColouredTitles,
                `${viewport.width}px: card titles must not use the link colour ${linkColor}\n${diagnostic}`,
            ).toEqual([]);

            const rows = rowsFor(metrics);
            for (const row of rows) {
                const heights = row.map(({ height }) => height);
                expect(
                    Math.max(...heights) - Math.min(...heights),
                    `${viewport.width}px: cards in a row have unequal heights\n${diagnostic}`,
                ).toBeLessThanOrEqual(MAX_OFFSET_PX);
            }

            if (viewport.width === 1280) {
                expect(
                    rows.some((row) => row.length > 1),
                    `1280px: no multi-card row was rendered\n${diagnostic}`,
                ).toBe(true);
            }
        });
    }
});
