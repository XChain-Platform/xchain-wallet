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
];

// The first entry is the neutral choice that fills nothing in.
const PICKER_ROWS = ['Select template', ...TEMPLATE_NAMES];

const MAX_OFFSET_PX = 1;

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function openCreateToken(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Create a token');
    await palette.getByRole('option', { name: /^Create a token\b/ }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Issue Token' })).toBeVisible();
}

async function cardMetrics(page) {
    // The templates are the options of the Select template dropdown.
    const picker = page.getByRole('listbox', { name: 'Select template' });
    if (!(await picker.isVisible())) {
        await page.getByRole('button', { name: /Select template/ }).click();
    }
    await expect(picker).toBeVisible();
    const cards = picker.getByRole('option');
    await expect(cards).toHaveCount(PICKER_ROWS.length);

    const metrics = [];
    for (let index = 0; index < PICKER_ROWS.length; index += 1) {
        const name = PICKER_ROWS[index];
        const card = cards.nth(index);
        const title = card.getByText(name, { exact: true }).first();
        await expect(card, `${name} card is not visible`).toBeVisible();
        await expect(title, `${name} title is not visible`).toBeVisible();

        metrics.push(await card.evaluate((element, titleText) => {
            // An option is an icon plus a text column of the name over its description.
            const iconElement = element.firstElementChild;
            const textColumn = element.children[1];
            const titleElement = textColumn?.children[0];
            const subtitleElement = textColumn?.children[1];
            if (!titleElement || titleElement.textContent.trim() !== titleText) {
                throw new Error(`No title element for ${titleText}`);
            }

            const cardBox = element.getBoundingClientRect();
            const titleBox = titleElement.getBoundingClientRect();
            const nameNode = [...titleElement.childNodes]
                .find((node) => node.nodeType === Node.TEXT_NODE
                    && node.textContent.trim() === titleText);
            if (!iconElement) throw new Error(`No icon element for ${titleText}`);
            if (!subtitleElement) throw new Error(`No description element for ${titleText}`);
            if (!nameNode) throw new Error(`No name text node for ${titleText}`);

            const nameRange = document.createRange();
            nameRange.selectNodeContents(nameNode);
            // The icon is centred on the whole name-over-description column.
            const textBox = textColumn.getBoundingClientRect();
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
                iconTextCenterOffset: Math.abs(
                    (iconBox.top + iconBox.height / 2) - (textBox.top + textBox.height / 2),
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

            const iconTextOffsets = metrics.map(({ iconTextCenterOffset }) => iconTextCenterOffset);
            expect(
                Math.max(...iconTextOffsets),
                `${viewport.width}px: template icons are not centred on their text\n${diagnostic}`,
            ).toBeLessThanOrEqual(MAX_OFFSET_PX);

            const descriptionAlignmentFailures = metrics
                .filter(({ descriptionInset, titleInset, descriptionGap }) => (
                    Math.abs(descriptionInset - titleInset) > MAX_OFFSET_PX
                    || descriptionGap < -MAX_OFFSET_PX
                ))
                .map(({ name }) => name);
            expect(
                descriptionAlignmentFailures,
                `${viewport.width}px: descriptions must sit under the title and align with it\n${diagnostic}`,
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
