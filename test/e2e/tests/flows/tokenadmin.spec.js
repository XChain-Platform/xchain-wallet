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
import { fieldByLabel } from '../../fixtures/fields.js';

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
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`, 'i') }).first().click();
    await expect(palette).toBeHidden();
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
        // Skip the "?" help tip on a field label (U57): it is part of the label, held to
        // the tap minimum rather than a control height, not a control in a row.
        const isHelpTip = (el) => el.tagName === 'BUTTON' && el.textContent.trim() === '?';
        const controls = [...Array.from(main.querySelectorAll(selector)).filter((el) => !el.closest('[aria-hidden="true"]') && !isHelpTip(el))].map((element) => {
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

// Issue token ends on the shared Confirm screen, labelled "Confirm <summary>";
// the other actions keep their own Review screen and form.
async function expectReview(page, {
    heading = 'Confirm',
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

    const form = formName
        ? page.getByRole('form', { name: formName, exact: true })
        : page.getByLabel(`Confirm ${summary}`, { exact: true });
    await expect(form).toBeVisible();
    await expect(form.getByText(summary, { exact: true })).toBeVisible();
    expect(await reviewDetails(form)).toMatchObject(details);
    await expectScreenLayout(page, heading, label);
}

async function openManagedToken(page) {
    await gotoPalette(page, 'My tokens');
    await expectScreenLayout(page, 'My Tokens', 'My tokens');
    // Search sits in the Filter tokens panel in the title bar.
    await page.getByRole('banner').getByRole('button', { name: 'Filter tokens', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter tokens' }).getByLabel('Search your tokens by ticker or description').fill('XCP');
    await page.keyboard.press('Escape');
    const row = page.getByRole('button', { name: 'Open XCP token details' }).first();
    await expect(row).toBeVisible();
    await row.click();
    // A narrow window titles the token page by its ticker; a wide one keeps the list
    // beside it, so the title stays My Tokens and the token opens as a panel.
    if (page.viewportSize().width < 1024) {
        await expectScreenLayout(page, 'XCP', 'Manage token');
    } else {
        await expect(page.getByRole('region', { name: 'XCP token management' })).toBeVisible();
        await expectScreenLayout(page, 'My Tokens', 'Manage token');
    }
}

for (const viewport of VIEWPORTS) {
    test(`token administration reaches every review at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Demo wallets hide the create commands, so this walk uses a real dev
        // wallet, created in watch-only mode (the mode is chosen at create).
        await createWallet(page, { walletMode: 'watcher' });

        const run = `${viewport.width}${viewport.height}`;
        const issueTick = `FLOW${run}`;

        await test.step('Issue token', async () => {
            // Issue token opens the one-page Issue Token form; its template is a
            // picker inside the Token section, not a page of its own.
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expectScreenLayout(page, 'Issue Token', `${viewport.name} Issue token`);

            // The Token section starts open with Ticker and Max supply; the
            // optional sections below it start closed. Each label carries a help
            // tip button named after it, so fields go through the shared lookup.
            const openSection = async (title) => {
                const header = main.getByRole('button', { name: new RegExp(`^${title}\\b`) });
                // Token starts open; the other sections start closed.
                if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
                await expect(header).toHaveAttribute('aria-expanded', 'true');
            };
            await fieldByLabel(main, 'Ticker').fill(issueTick);
            await fieldByLabel(main, 'Max supply').fill('1000');
            await openSection('Initial mint');
            await fieldByLabel(main, 'Initial mint').fill('250');
            await openSection('Public minting');
            await fieldByLabel(main, 'Max per transaction').fill('50');
            await openSection('Description');
            await fieldByLabel(main, 'Token description').fill('Responsive token admin fixture');
            await expectScreenLayout(page, 'Issue Token', `${viewport.name} Issue token with sections open`);
            await page.waitForTimeout(450);
            await scrollFormToBottom(page);
            // With a supply set the main button reads Issue token (ruling U80).
            await main.getByRole('button', { name: 'Issue Token', exact: true }).click();

            await expectReview(page, {
                summary: `Issue a new token, ${issueTick}`,
                details: {
                    // Review amounts carry their unit.
                    'Max supply': `1,000 ${issueTick}`,
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
            await main.getByRole('button', { name: 'Mint', exact: true }).click();

            await expectReview(page, {
                heading: 'Review Mint',
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
            await expectScreenLayout(page, 'Pay Dividend', `${viewport.name} Dividend`);
            await selectNamedToken(page, 'Holder-of token', { ...CHAIN, tick: 'XCP' });
            await selectNamedToken(page, 'Dividend token', { ...CHAIN, tick: 'PEPECASH' });

            const main = page.getByRole('main');
            await main.getByRole('textbox', { name: /^Per-unit amount/ }).fill('0.0001');
            // Memo is an optional section that starts closed.
            const memoHeader = main.getByRole('button', { name: /^Memo\b/ });
            if (await memoHeader.getAttribute('aria-expanded') !== 'true') await memoHeader.click();
            await main.getByLabel('Memo', { exact: true }).fill('Quarterly payout');
            const preview = main.getByRole('button', { name: 'Pay Dividend', exact: true });
            await expect(preview).toBeEnabled();
            await scrollFormToBottom(page);
            // The form refuses until the holder list has loaded, so press again until the review opens.
            await expect(async () => {
                if (await page.getByRole('heading', { level: 1, name: 'Confirm', exact: true }).isVisible()) return;
                await preview.click({ timeout: 5_000 });
                await expect(page.getByRole('heading', { level: 1, name: 'Confirm', exact: true })).toBeVisible({ timeout: 5_000 });
            }).toPass({ timeout: 60_000 });

            await expectReview(page, {
                summary: 'Pay 0.0001 PEPECASH per unit of XCP',
                details: {
                    'Holders of': 'XCP',
                    Receive: 'PEPECASH',
                    'Per-unit amount': '0.0001',
                    Memo: 'Quarterly payout',
                },
                label: `${viewport.name} Dividend review`,
            });
        });

        await test.step('Destroy', async () => {
            await openManagedToken(page);
            // Manage token's Actions tab is one icon grid of every action, Destroy
            // included, with no More menu (ruling U78).
            await expect(page.getByRole('tab', { name: 'Actions' })).toHaveAttribute('aria-selected', 'true');
            // A watch-only wallet cannot sign, so the tile is disabled and says why; the
            // palette still opens the form to prepare the transaction for another phone.
            const destroyTile = page.getByRole('main').getByRole('button', { name: /^Destroy\b/ });
            await expect(destroyTile).toBeDisabled();
            await expect(destroyTile).toContainText('another phone signs for this one');
            await gotoPalette(page, 'Destroy');
            await expectScreenLayout(page, 'Destroy', `${viewport.name} Destroy`);

            await selectNamedToken(page, 'Token', { ...CHAIN, tick: 'XCP' });
            const main = page.getByRole('main');
            await main.getByRole('textbox', { name: /^Amount/ }).fill('2');
            await scrollFormToBottom(page);
            await main.getByRole('button', { name: 'Destroy', exact: true }).click();

            await expectReview(page, {
                summary: 'Destroy 2 XCP',
                details: { Network: 'Bitcoin' },
                label: `${viewport.name} Destroy review`,
            });
        });
    });
}
