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
    gotoSection,
    nav,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';

const WALLET_NAME = 'Header controls wallet';
const VIEWPORTS = [
    { name: 'phone portrait', width: 360, height: 800 },
    { name: 'phone landscape', width: 844, height: 390 },
    { name: 'tablet portrait', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
];
const INTERACTIVE_SELECTOR = [
    'button:not(:disabled)',
    'a[href]',
    'input:not(:disabled):not([type="hidden"])',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function visibleInteractiveCount(locator) {
    return locator.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => elements.filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden'
            && style.display !== 'none'
            && rect.width > 0
            && rect.height > 0;
    }).length);
}

async function expectKeyboardReachable(page, controls, viewportName) {
    const markers = await controls.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => {
        const visible = elements.filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden'
                && style.display !== 'none'
                && rect.width > 0
                && rect.height > 0;
        });
        visible.forEach((element, index) => {
            element.dataset.e2eHeaderControl = String(index);
        });
        return visible.map((_, index) => String(index));
    });

    const tabStops = await page.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => elements.filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return element.tabIndex >= 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && rect.width > 0
            && rect.height > 0;
    }).length);

    await page.locator('body').evaluate((body) => {
        body.dataset.e2eOriginalTabindex = body.getAttribute('tabindex') ?? '';
        body.setAttribute('tabindex', '-1');
        body.focus();
    });

    const reached = new Set();
    for (let index = 0; index <= tabStops; index += 1) {
        await page.keyboard.press('Tab');
        const marker = await page.evaluate(() => document.activeElement?.dataset.e2eHeaderControl ?? null);
        if (marker !== null) reached.add(marker);
        if (reached.size === markers.length) break;
    }

    await page.evaluate(() => {
        document.querySelectorAll('[data-e2e-header-control]').forEach((element) => {
            delete element.dataset.e2eHeaderControl;
        });
        const body = document.body;
        const original = body.dataset.e2eOriginalTabindex;
        delete body.dataset.e2eOriginalTabindex;
        if (original) body.setAttribute('tabindex', original);
        else body.removeAttribute('tabindex');
    });

    expect(
        [...reached].sort(),
        `${viewportName}: every visible header control must occur in the keyboard tab order`,
    ).toEqual(markers);
}

// Header menu destinations are menu items; navigation destinations are buttons.
async function hasVisibleButton(scope, name) {
    const matches = [
        ...await scope.getByRole('button', { name }).all(),
        ...await scope.getByRole('menuitem', { name }).all(),
    ];
    const visibility = await Promise.all(matches.map((match) => match.isVisible()));
    return visibility.some(Boolean);
}

async function expectHeaderOrNavDestinations(page, header, viewportName) {
    const destinations = [
        { label: 'Settings', name: /^Settings\b/ },
        { label: 'Search', name: /^(Search|Open command palette)\b/ },
        { label: 'Scan', name: /^(Scan|Scan and addresses)\b/ },
    ];
    const reachable = new Set();
    const record = async (surfaces) => {
        for (const destination of destinations) {
            const available = await Promise.all(
                surfaces.map((surface) => hasVisibleButton(surface, destination.name)),
            );
            if (available.some(Boolean)) reachable.add(destination.label);
        }
    };

    // The condensed header keeps its secondary actions in one action menu.
    const openMenu = header.getByRole('button', { name: 'Open menu' });
    await openMenu.focus();
    await page.keyboard.press('Enter');
    const headerMenu = page.getByRole('menu', { name: 'Header actions' });
    await expect(headerMenu).toBeVisible();
    const navigation = nav(page);
    await record([header, headerMenu, navigation, page.getByRole('main')]);
    await page.keyboard.press('Escape');
    await expect(headerMenu).toBeHidden();

    const more = navigation.getByRole('button', { name: 'More', exact: true });
    if (await more.isVisible().catch(() => false)) {
        await more.focus();
        await page.keyboard.press('Enter');
        const moreDialog = page.getByRole('dialog', { name: 'More', exact: true });
        await expect(moreDialog).toBeVisible();
        await record([moreDialog]);
        await page.keyboard.press('Escape');
    }

    for (const destination of destinations) {
        expect(
            reachable.has(destination.label),
            `${viewportName}: ${destination.label} must remain reachable through the header menu or navigation`,
        ).toBe(true);
    }

    await gotoSection(page, 'Home');
    await expect(unlockedShell(page)).toBeVisible();
}

test.describe('layout: app header controls', () => {
    test('keeps identity, actions, and navigation reachable at representative viewports', async ({ page }) => {
        await createWallet(page, { name: WALLET_NAME });

        for (const viewport of VIEWPORTS) {
            await test.step(viewport.name, async () => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await gotoSection(page, 'Home');
                await expect(unlockedShell(page)).toBeVisible();
                await settle(page);

                const header = page.getByRole('region', { name: 'App header' });
                await expect(header.getByRole('img', { name: 'XChain Wallet' })).toBeVisible();
                const walletIdentity = header.getByTestId('wallet-identity');
                await expect(walletIdentity).toBeVisible();
                await expect(walletIdentity).toContainText(`Wallet: ${WALLET_NAME}`);

                const headerColumns = header.locator(':scope > div');
                await expect(headerColumns).toHaveCount(2);
                const rightControls = headerColumns.nth(1);
                const controlCount = await visibleInteractiveCount(rightControls);
                expect(controlCount, `${viewport.name}: the header must expose a right-side control`)
                    .toBeGreaterThan(0);
                expect(
                    controlCount,
                    `${viewport.name}: the header must expose no more than three right-side controls`,
                ).toBeLessThanOrEqual(3);
                await expectKeyboardReachable(page, rightControls, viewport.name);

                await expectHeaderOrNavDestinations(page, header, viewport.name);
            });
        }
    });
});
