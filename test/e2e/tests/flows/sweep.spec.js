// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
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
const TEST_WIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
// The demo wallet runs on Bitcoin regtest, so the destination is a regtest address.
const DESTINATION = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible({ timeout: 15_000 });
    await palette.getByRole('combobox').fill(title);
    const option = palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(option, `no palette command matching "${title}"`).toBeVisible();
    await option.click();
    await expect(palette).toBeHidden({ timeout: 15_000 });
}

async function expectMatchingInlineControlHeights(page, label) {
    const mismatches = await page.getByRole('main').evaluate((main) => {
        // Skip aria-hidden subtrees: decoration such as the fee slider tick labels, not controls.
        const controls = [...Array.from(main.querySelectorAll(
            'button, input:not([type="hidden"]), select, textarea',
        )).filter((el) => !el.closest('[aria-hidden="true"]'))].flatMap((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden'
                || box.width < 1 || box.height < 1) return [];
            return [{
                name: element.getAttribute('aria-label')
                    || element.labels?.[0]?.textContent?.trim()
                    || element.textContent?.trim()
                    || element.tagName.toLowerCase(),
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                height: box.height,
            }];
        });
        const result = [];

        for (let i = 0; i < controls.length; i += 1) {
            for (let j = i + 1; j < controls.length; j += 1) {
                const a = controls[i];
                const b = controls[j];
                const separateColumns = a.right <= b.left + 1 || b.right <= a.left + 1;
                const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (!separateColumns || overlap < Math.min(a.height, b.height) * 0.75) continue;
                const difference = Math.abs(a.height - b.height);
                if (difference > 2) {
                    result.push({
                        controls: [a.name, b.name],
                        heights: [Math.round(a.height), Math.round(b.height)],
                        difference,
                    });
                }
            }
        }
        return result;
    });

    expect(mismatches, `${label}: controls sharing a line differ in height by more than 2px`)
        .toEqual([]);
}

async function expectScreenLayout(page, heading, label) {
    await expect(page.getByRole('heading', { level: 1, name: heading }),
        `${label}: screen has no visible heading`).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(offenders, `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`)
        .toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, `${label}: document scrolls horizontally`)
        .toBeLessThanOrEqual(clientWidth + 1);

    await expectMatchingInlineControlHeights(page, label);
}

async function checkPrivateKeyScrubbing(page, label) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByRole('tab', { name: 'Private key' }).click();
    await expectScreenLayout(page, /Import (?:a )?private key/, `${label} private-key import`);

    await page.getByLabel('WIF private key').fill(TEST_WIF);
    await page.getByRole('tab', { name: 'Recovery phrase' }).click();
    await page.getByRole('tab', { name: 'Private key' }).click();

    const keyIsCleared = await page.getByLabel('WIF private key').inputValue() === '';
    expect(keyIsCleared, `${label}: the WIF remains in the field after leaving its import lane`)
        .toBe(true);
    await page.getByRole('button', { name: 'Back to wallet setup' }).click();
    await expect(page.getByRole('button', { name: 'Try in demo mode' })).toBeVisible();
    // Leave the app entirely so the demo entry starts from a blank page, as in
    // every other spec; a second load of the same URL straight from the setup
    // screen is aborted intermittently.
    await page.goto('about:blank');
}

async function setWatcherMode(page, label) {
    await gotoPalette(page, 'Settings');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Wallet mode/i }).click();
    await expectScreenLayout(page, 'Wallet mode', `${label} wallet mode`);

    const watcher = main.getByRole('radio', { name: /^Watcher/ });
    await watcher.click();
    const confirmation = page.getByRole('dialog', { name: 'Switch to Watcher (watch-only) mode?' });
    await confirmation.getByRole('button', { name: 'Confirm mode change' }).click();
    await expect(confirmation).toBeHidden();
    await expect(watcher).toBeChecked();
}

function detailValue(review, label) {
    return review.locator('dt').filter({ hasText: new RegExp(`^${label}$`) })
        .first().locator('xpath=following-sibling::dd[1]');
}

for (const viewport of VIEWPORTS) {
    test(`sweep preview and review render at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await checkPrivateKeyScrubbing(page, viewport.name);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await setWatcherMode(page, viewport.name);

        await gotoPalette(page, 'Sweep address');
        const main = page.getByRole('main');
        await expect(main.getByRole('form', { name: 'Sweep address' }))
            .toBeVisible({ timeout: 30_000 });
        await expectScreenLayout(page, 'Sweep address', `${viewport.name} sweep form`);

        const source = await main.getByRole('textbox', { name: 'From', exact: true }).inputValue();
        expect(source.length, `${viewport.name}: sweep source is empty`).toBeGreaterThan(0);
        await main.getByRole('textbox', { name: 'Destination address' }).fill(DESTINATION);

        await expect(main.getByRole('checkbox', { name: /^Token balances \(\d+\)$/ }))
            .toBeVisible({ timeout: 30_000 });
        await expect(main.getByRole('checkbox', { name: /^Token ownerships \(\d+\)$/ }))
            .toBeVisible({ timeout: 30_000 });
        await expect(main.getByText(/PEPECASH/).first()).toBeVisible();
        await expectScreenLayout(page, 'Sweep address', `${viewport.name} populated sweep preview`);

        const scrolled = await main.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            return element.scrollTop;
        });
        expect(scrolled, `${viewport.name}: the populated sweep form did not scroll`)
            .toBeGreaterThan(0);
        await main.getByRole('button', { name: 'Preview', exact: true }).click();

        const review = main.getByRole('form', { name: 'Review sweep' });
        await expect(review).toBeVisible({ timeout: 30_000 });
        await settle(page);
        expect(await main.evaluate((element) => element.scrollTop),
            `${viewport.name}: sweep review did not open at the top`).toBeLessThanOrEqual(1);
        // The chain shows as its icon badge, named for screen readers.
        await expect(detailValue(review, 'Chain').getByRole('img', { name: 'Bitcoin' })).toBeVisible();
        // Addresses are middle-truncated on screen; the accessible name is the full value.
        await expect(detailValue(review, 'From').getByLabel(source, { exact: true })).toBeVisible();
        await expect(detailValue(review, 'Destination').getByLabel(DESTINATION, { exact: true })).toBeVisible();
        await expect(detailValue(review, 'Sweeps'))
            .toHaveText('Token balances, Token ownerships');
        await expectScreenLayout(page, 'Review sweep', `${viewport.name} sweep review`);
    });
}
