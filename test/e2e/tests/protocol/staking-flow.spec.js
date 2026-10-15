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
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

const STAKE_AMOUNT = '125.5';
const SIGNING_PUBLIC_KEY = 'a'.repeat(64);

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function openPaletteItem(page, title, subtitle) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    const option = palette.getByRole('option').filter({ hasText: subtitle }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(palette).toBeHidden();
}

async function setWatcherMode(page) {
    await openPaletteItem(page, 'Settings', 'Open settings');
    const walletMode = page.getByRole('main').getByRole('button', { name: /^Wallet mode/ });
    await expect(walletMode).toBeVisible();
    await walletMode.click();
    const watcher = page.getByRole('radio', { name: /^Watcher/ });
    await expect(watcher).toBeVisible();
    await watcher.click();
    // Switching mode asks for confirmation in a modal that blocks the palette.
    const confirmation = page.getByRole('dialog', { name: 'Switch to Watcher (watch-only) mode?' });
    await confirmation.getByRole('button', { name: 'Confirm mode change' }).click();
    await expect(confirmation).toBeHidden();
    await expect(watcher).toBeChecked();
}

async function expectScreenFits(page, heading, label) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: document width ${scrollWidth}px exceeds its ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectSameLineHeights(controls, label) {
    const boxes = [];
    for (const control of controls) {
        await expect(control).toBeVisible();
        boxes.push(await control.boundingBox());
    }

    expect(boxes.every(Boolean), `${label}: every control has a layout box`).toBe(true);
    const tops = boxes.map((box) => box.y);
    // On phones the filter keeps room for its label and wraps below the
    // search field; stacked controls then share the same left edge instead.
    const sameLine = Math.max(...tops) - Math.min(...tops) <= 2;
    const stacked = Math.max(...boxes.map((box) => box.x)) - Math.min(...boxes.map((box) => box.x)) <= 2;
    expect(sameLine || stacked, `${label}: controls neither share a line nor stack on one edge`).toBe(true);

    const heights = boxes.map((box) => box.height);
    expect(
        Math.max(...heights) - Math.min(...heights),
        `${label}: same-line control heights differ (${heights.join(', ')}px)`,
    ).toBeLessThanOrEqual(2);
}

// Action forms read the wallet's real XCHAIN balance, which is zero in both a
// demo and a fresh wallet. Keeping the debounced balance read unresolved
// exercises the review-only watcher path without signing or inventing a chain
// result, and the timer is released as soon as the review renders.
async function holdStakeBalanceLookup(page) {
    await page.evaluate(() => {
        const originalSetTimeout = window.setTimeout;
        const heldTimers = [];
        window.setTimeout = function holdBalanceTimer(callback, delay, ...args) {
            const effectiveDelay = delay === 400 ? 60_000 : delay;
            const timer = originalSetTimeout.call(window, callback, effectiveDelay, ...args);
            if (delay === 400) heldTimers.push(timer);
            return timer;
        };
        window.__restoreStakeBalanceTimers = () => {
            window.setTimeout = originalSetTimeout;
            heldTimers.forEach((timer) => window.clearTimeout(timer));
            delete window.__restoreStakeBalanceTimers;
        };
    });
}

async function releaseStakeBalanceLookup(page) {
    await page.evaluate(() => window.__restoreStakeBalanceTimers?.());
}

/** Opens Validator staking from Staking and fills a new stake. */
async function fillNewStake(page, viewport) {
    // The page header's action: an empty Staking list repeats it in its body.
    await page.getByRole('banner').getByRole('button', { name: 'New stake', exact: true }).click();
    await expectScreenFits(page, 'New stake', `${viewport.name} new stake chooser`);

    await page.getByRole('button', { name: /^Validator staking/ }).click();
    // Both the demo wallet and a created one hold a single Bitcoin chain, so
    // Validator staking opens the stake form directly on it.
    await expect(page.getByRole('form', { name: 'Stake XCHAIN' })).toBeVisible();

    await expectScreenFits(page, 'Stake XCHAIN', `${viewport.name} new stake form`);
    await expect(page.getByRole('button', { name: 'Network: Bitcoin' }))
        .toBeVisible();

    const form = page.getByRole('form', { name: 'Stake XCHAIN' });
    await form.getByLabel('Signing public key', { exact: true }).fill(SIGNING_PUBLIC_KEY);
    await form.getByRole('textbox', { name: /^Amount/ }).fill(STAKE_AMOUNT);
    await expect(form.getByRole('radio', { name: 'New stake', exact: true })).toBeChecked();
    await expectScreenFits(page, 'Stake XCHAIN', `${viewport.name} completed stake form`);
    return form;
}

for (const viewport of VIEWPORTS) {
    test(`staking positions, detail, and the demo stake form fit the ${viewport.name} viewport`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await setWatcherMode(page);

        await test.step('Your staking positions', async () => {
            await openPaletteItem(page, 'Staking', 'Your staking positions');
            await expectScreenFits(page, 'Staking', `${viewport.name} staking positions`);

            await expectSameLineHeights([
                page.getByRole('searchbox', { name: 'Search staking positions' }),
                page.getByRole('button', { name: 'Filter by network' }),
            ], `${viewport.name} staking toolbar`);

            await expect(page.getByRole('listitem', { name: /^Open Validator stake/ })).toBeVisible();
        });

        await test.step('stake detail', async () => {
            await page.getByRole('listitem', { name: /^Open Validator stake/ }).click();
            await expectScreenFits(page, 'Validator stake', `${viewport.name} validator stake detail`);
            await expect(page.getByRole('main').getByText('50,000 XCHAIN', { exact: true }))
                .toBeVisible();

            const actions = page.getByRole('group', { name: 'Stake actions' });
            await expectSameLineHeights([
                actions.getByRole('button', { name: 'Claim', exact: true }),
                actions.getByRole('button', { name: 'Unstake', exact: true }),
                actions.getByRole('button', { name: 'Delegate', exact: true }),
                actions.getByRole('button', { name: 'More', exact: true }),
            ], `${viewport.name} stake actions`);

            await page.getByRole('button', { name: 'Back to staking' }).click();
            await expect(page.getByRole('heading', { name: 'Staking', exact: true })).toBeVisible();
        });

        await test.step('new stake form stops at the demo note', async () => {
            await holdStakeBalanceLookup(page);
            const form = await fillNewStake(page, viewport);
            // A demo wallet cannot move funds, so its stake form keeps Preview
            // disabled under the demo note; the review is walked in a created
            // wallet below.
            await expect(form.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
            await expect(page.getByRole('main').getByText(/Demo wallets can.t move funds/)).toBeVisible();
            await expectScreenFits(page, 'Stake XCHAIN', `${viewport.name} demo stake note`);
            await releaseStakeBalanceLookup(page);
        });
    });

    test(`stake review fits the ${viewport.name} viewport`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await createWallet(page);
        await setWatcherMode(page);
        await openPaletteItem(page, 'Staking', 'Your staking positions');
        await expectScreenFits(page, 'Staking', `${viewport.name} empty staking positions`);

        await test.step('new stake form', async () => {
            await holdStakeBalanceLookup(page);
            const form = await fillNewStake(page, viewport);
            const main = page.getByRole('main');
            await main.evaluate((element) => { element.scrollTop = 0; });
            await form.getByRole('button', { name: 'Preview', exact: true })
                .evaluate((button) => button.click());
        });

        await test.step('stake review', async () => {
            await expectScreenFits(page, 'Review stake', `${viewport.name} stake review`);
            await releaseStakeBalanceLookup(page);

            const main = page.getByRole('main');
            expect(await main.evaluate((element) => element.scrollTop),
                `${viewport.name} review does not open at the top`).toBeLessThanOrEqual(1);

            const review = page.getByRole('form', { name: 'Review stake' });
            await expect(review).toContainText(`Stake ${STAKE_AMOUNT} XCHAIN`);
            const amountLabel = review.locator('dt').filter({ hasText: /^Amount$/ });
            await expect(amountLabel).toHaveText('Amount');
            await expect(amountLabel.locator('xpath=following-sibling::dd[1]'))
                .toHaveText(`${STAKE_AMOUNT} XCHAIN`);
            await expect(review.locator('dt').filter({ hasText: /^Mode$/ })
                .locator('xpath=following-sibling::dd[1]'))
                .toHaveText('New stake');
        });
    });
}
