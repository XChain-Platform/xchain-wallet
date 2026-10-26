// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    test,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';
import { selectNamedToken } from '../../fixtures/crossChain.js';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

// The dev wallet holds its tokens on Bitcoin.
const CHAIN = {
    chainId: 'bitcoin-mainnet',
    chainLabel: 'Bitcoin',
};

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => (
        requestAnimationFrame(() => requestAnimationFrame(resolve))
    )));
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function useWatcherReviews(page) {
    await gotoPalette(page, 'Settings');
    await page.getByRole('button', { name: /^Wallet mode/ }).click();

    const watcher = page.getByRole('radio', { name: /^Watcher/ });
    await expect(watcher).toBeVisible();
    await watcher.click();

    const confirmation = page.getByRole('dialog', { name: /Switch to Watcher/ });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Confirm mode change' }).click();
    await expect(confirmation).toBeHidden();
    await expect(watcher).toBeChecked();
}

async function expectAlignedControlRows(page, label) {
    const mismatches = await page.getByRole('main').evaluate((main) => {
        const selector = [
            'button',
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
            'select',
            'textarea',
            '[role="switch"]',
        ].join(',');
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll(selector)).filter((el) => !el.closest('[aria-hidden="true"]'))].map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                element,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                visible: rect.width > 0 && rect.height > 0
                    && style.display !== 'none' && style.visibility !== 'hidden',
            };
        }).filter((control) => control.visible);

        const failures = [];
        for (let i = 0; i < controls.length; i += 1) {
            for (let j = i + 1; j < controls.length; j += 1) {
                const a = controls[i];
                const b = controls[j];
                const sameLine = Math.abs(a.top - b.top) <= 2;
                const separateColumns = a.right <= b.left + 1 || b.right <= a.left + 1;
                if (!sameLine || !separateColumns) continue;
                const delta = Math.abs(a.height - b.height);
                if (delta <= 2) continue;
                const name = (element) => (
                    element.getAttribute('aria-label')
                    || element.getAttribute('name')
                    || element.textContent
                    || element.tagName
                ).trim().replace(/\s+/g, ' ').slice(0, 60);
                failures.push({
                    first: name(a.element),
                    firstHeight: Math.round(a.height * 10) / 10,
                    second: name(b.element),
                    secondHeight: Math.round(b.height * 10) / 10,
                    delta: Math.round(delta * 10) / 10,
                });
            }
        }
        return failures;
    });

    expect(mismatches, `${label}: controls sharing a line differ in height by more than 2px`)
        .toEqual([]);
}

async function expectScreenLayout(page, heading, label) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true }))
        .toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const overflow = await documentOverflow(page);
    expect(
        overflow.scrollWidth,
        `${label}: document width ${overflow.scrollWidth}px exceeds ${overflow.clientWidth}px`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const mainOverflow = await page.getByRole('main').evaluate((main) => ({
        scrollWidth: main.scrollWidth,
        clientWidth: main.clientWidth,
    }));
    expect(
        mainOverflow.scrollWidth,
        `${label}: main content width ${mainOverflow.scrollWidth}px exceeds ${mainOverflow.clientWidth}px`,
    ).toBeLessThanOrEqual(mainOverflow.clientWidth + 1);

    await expectAlignedControlRows(page, label);
}

async function scrollFormToBottom(page) {
    await page.getByRole('main').evaluate((main) => {
        main.scrollTop = main.scrollHeight;
    });
}

async function reviewDetails(form) {
    return form.locator('dl').first().evaluate((list) => {
        const details = {};
        let label = null;
        for (const child of list.children) {
            const text = (child.textContent || '').trim().replace(/\s+/g, ' ');
            if (child.tagName === 'DT') label = text;
            if (child.tagName === 'DD' && label) {
                details[label] = text;
                label = null;
            }
        }
        return details;
    });
}

async function expectReview(page, {
    heading,
    formName,
    summary,
    details,
    label,
}) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true }))
        .toBeVisible();
    await expect.poll(
        () => page.getByRole('main').evaluate((main) => main.scrollTop),
        { message: `${label}: review did not open at the top` },
    ).toBeLessThanOrEqual(1);

    const form = page.getByRole('form', { name: formName, exact: true });
    await expect(form).toBeVisible();
    await expect(form.getByText(summary, { exact: true })).toBeVisible();
    expect(await reviewDetails(form)).toMatchObject(details);
    await expectScreenLayout(page, heading, label);
}

async function openManagedToken(page) {
    await gotoPalette(page, 'My tokens');
    await expectScreenLayout(page, 'My tokens', 'My tokens');
    await page.getByLabel('Search your tokens by ticker or description').fill('XCP');
    const row = page.getByRole('button', { name: 'Open XCP token details' }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expectScreenLayout(page, 'Manage token', 'Manage token');
    await expect(page.getByRole('main').getByText('XCP', { exact: true }).first()).toBeVisible();
}

for (const viewport of VIEWPORTS) {
    test(`token administration reaches every review at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Demo wallets hide the create commands, so this walk uses a real dev wallet.
        await createWallet(page);
        await useWatcherReviews(page);

        const run = `${viewport.width}${viewport.height}`;
        const issueTick = `FLOW${run}`;

        await test.step('Issue token', async () => {
            await gotoPalette(page, 'Issue token');
            await expectScreenLayout(page, 'Issue token', `${viewport.name} Issue token`);

            const main = page.getByRole('main');
            await main.getByLabel('Ticker').fill(issueTick);
            await main.getByLabel('Supply', { exact: true }).fill('1000');
            await main.getByLabel('Initial mint (optional)').fill('250');
            await main.getByLabel('Max mint per transaction (optional)').fill('50');
            await main.getByLabel('Description (optional)').fill('Responsive token admin fixture');
            await page.waitForTimeout(450);
            await scrollFormToBottom(page);
            await main.getByRole('button', { name: 'Preview', exact: true }).click();

            await expectReview(page, {
                heading: 'Review issue',
                formName: 'Review token issue',
                summary: `Create token ${issueTick} with max supply 1000 on Bitcoin`,
                details: {
                    Token: issueTick,
                    // Review amounts carry their unit.
                    'Max supply': `1000 ${issueTick}`,
                    'Max mint per tx': `50 ${issueTick}`,
                    Description: 'Responsive token admin fixture',
                    'Initial mint': `250 ${issueTick}`,
                },
                label: `${viewport.name} Issue review`,
            });
        });

        await test.step('Manage token', async () => {
            await openManagedToken(page);
        });

        await test.step('Mint', async () => {
            await gotoPalette(page, 'Mint supply');
            await expectScreenLayout(page, 'Mint', `${viewport.name} Mint`);
            await selectNamedToken(page, 'Token', { ...CHAIN, tick: 'XCP' });

            const main = page.getByRole('main');
            await main.getByRole('textbox', { name: /^Amount/ }).fill('25');
            await scrollFormToBottom(page);
            await main.getByRole('button', { name: 'Preview', exact: true }).click();

            await expectReview(page, {
                heading: 'Review mint',
                formName: 'Review mint',
                summary: 'Mint 25 XCP on Bitcoin',
                details: {
                    Token: 'XCP',
                    Amount: '25 XCP',
                    Destination: 'broadcasting address',
                },
                label: `${viewport.name} Mint review`,
            });
        });

        await test.step('Dividend', async () => {
            await gotoPalette(page, 'Pay a dividend');
            await expectScreenLayout(page, 'Pay dividend', `${viewport.name} Dividend`);
            await selectNamedToken(page, 'Holder-of token', { ...CHAIN, tick: 'XCP' });
            await selectNamedToken(page, 'Dividend token', { ...CHAIN, tick: 'PEPECASH' });

            const main = page.getByRole('main');
            await main.getByRole('textbox', { name: /^Per-unit amount/ }).fill('0.0001');
            await main.getByLabel('Memo (optional)').fill('Quarterly payout');
            const preview = main.getByRole('button', { name: 'Preview', exact: true });
            await expect(preview).toBeEnabled();
            await scrollFormToBottom(page);
            await preview.click();

            await expectReview(page, {
                heading: 'Review dividend',
                formName: 'Review dividend',
                summary: 'Pay 0.0001 PEPECASH per unit of XCP on Bitcoin',
                details: {
                    'Holders of': 'XCP',
                    Receive: 'PEPECASH',
                    'Per-unit amount': '0.0001 PEPECASH',
                    Memo: 'Quarterly payout',
                },
                label: `${viewport.name} Dividend review`,
            });
        });

        await test.step('Destroy from Manage token', async () => {
            await openManagedToken(page);
            // A holder who is not the issuer sees Dispenser, Dividends and Airdrop
            // first, so Destroy sits under More.
            await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).click();
            await page.getByRole('main').getByRole('menuitem', { name: 'Destroy', exact: true }).click();
            await expectScreenLayout(page, 'Destroy', `${viewport.name} Destroy`);

            const main = page.getByRole('main');
            await main.getByRole('textbox', { name: /^Amount/ }).fill('2');
            await scrollFormToBottom(page);
            await main.getByRole('button', { name: 'Preview', exact: true }).click();

            await expectReview(page, {
                heading: 'Review destroy',
                formName: 'Review destroy',
                summary: 'Destroy 2 XCP on Bitcoin',
                details: {
                    Token: 'XCP',
                    Amount: '2 XCP',
                },
                label: `${viewport.name} Destroy review`,
            });
        });
    });
}
