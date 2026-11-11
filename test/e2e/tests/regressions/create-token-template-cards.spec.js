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
    createWallet,
    expect,
    test,
} from '../../fixtures/wallet.js';

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
            // The title is the icon plus the name; the row's subtitle sits after its title line.
            const titleElement = element.querySelector('[data-template-title]');
            if (!titleElement || titleElement.textContent.trim() !== titleText) {
                throw new Error(`No title element for ${titleText}`);
            }

            const cardBox = element.getBoundingClientRect();
            const titleBox = titleElement.getBoundingClientRect();
            const iconElement = titleElement.querySelector(':scope > span[aria-hidden="true"]');
            const subtitleElement = titleElement.parentElement?.nextElementSibling;
            const nameNode = [...titleElement.childNodes]
                .find((node) => node.nodeType === Node.TEXT_NODE
                    && node.textContent.trim() === titleText);
            if (!iconElement) throw new Error(`No icon element for ${titleText}`);
            if (!subtitleElement) throw new Error(`No description element for ${titleText}`);
            if (!nameNode) throw new Error(`No name text node for ${titleText}`);

            const nameRange = document.createRange();
            nameRange.selectNodeContents(nameNode);
            const nameBox = nameRange.getBoundingClientRect();
            const iconBox = iconElement.getBoundingClientRect();
            const subtitleBox = subtitleElement.getBoundingClientRect();
            const titleStyle = getComputedStyle(titleElement);
            return {
                name: titleText,
                top: cardBox.top,
                height: cardBox.height,
                titleInset: titleBox.left - cardBox.left,
                titleColor: titleStyle.color,
                nameLineCount: nameRange.getClientRects().length,
                iconNameCenterOffset: Math.abs(
                    (iconBox.top + iconBox.height / 2) - (nameBox.top + nameBox.height / 2),
                ),
                descriptionInset: subtitleBox.left - cardBox.left,
                iconInset: iconBox.left - cardBox.left,
                descriptionGap: subtitleBox.top - titleBox.bottom,
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

test('Create token template cards retain their visual hierarchy', async ({ page }) => {
    test.slow();
    await page.setViewportSize(VIEWPORTS[0]);
    // Demo wallets hide the create commands, so this walk uses a real dev wallet.
    await createWallet(page);
    await openCreateToken(page);

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width} by ${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            await settle(page);

            const { linkColor, metrics } = await cardMetrics(page);
            const diagnostic = JSON.stringify({ linkColor, metrics }, null, 2);

            const wrappedNames = metrics
                .filter(({ nameLineCount }) => nameLineCount !== 1)
                .map(({ name }) => name);
            expect(
                wrappedNames,
                `${viewport.width}px: every template name must stay on one line with its icon\n${diagnostic}`,
            ).toEqual([]);

            const iconNameOffsets = metrics.map(({ iconNameCenterOffset }) => iconNameCenterOffset);
            expect(
                Math.max(...iconNameOffsets),
                `${viewport.width}px: template icons and names do not share a line\n${diagnostic}`,
            ).toBeLessThanOrEqual(MAX_OFFSET_PX);

            const descriptionAlignmentFailures = metrics
                .filter(({ descriptionInset, iconInset, descriptionGap }) => (
                    Math.abs(descriptionInset - iconInset) > MAX_OFFSET_PX
                    || descriptionGap < -MAX_OFFSET_PX
                ))
                .map(({ name }) => name);
            expect(
                descriptionAlignmentFailures,
                `${viewport.width}px: descriptions must sit under the title and align with the icon\n${diagnostic}`,
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
            expect(
                rows.every((row) => row.length === 1),
                `${viewport.width}px: templates must render as one list row each\n${diagnostic}`,
            ).toBe(true);
        });
    }
});
