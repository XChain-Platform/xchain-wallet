// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 360, height: 800 },
    { name: 'desktop', width: 1280, height: 800 },
];

const TOP_LEVEL_ROUTES = [
    { name: 'Home' },
    { name: 'History' },
    { name: 'Send' },
    { name: 'Receive' },
    { name: 'Scan' },
    { name: 'DEX' },
    { name: 'Marketplace', paletteName: 'Marketplace' },
    { name: 'Dispensers' },
    { name: 'Contracts' },
    { name: 'Messaging' },
    { name: 'Contacts' },
    { name: 'Lists' },
    { name: 'Payments due' },
    { name: 'Settings' },
];

const SETTINGS_SUBPAGES = [
    'This wallet',
    'Display',
    'Keyboard',
    'Privacy',
    'Safety',
    'Wallet mode',
    'Backup',
    'Fees',
    'Connected sites',
    'Automatic donation system',
    'About',
];

const NETWORK_LABEL_RE = /\b(?:regtest|testnet)\b|Not mainnet/i;
const MAX_HEADER_HEIGHT_PX = 64;
const MAX_ROW_OFFSET_PX = 4;

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function gotoPaletteRoute(page, name) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(name);
    await palette.getByRole('option', {
        name: new RegExp(`^${escapeRegExp(name)}\\b`),
    }).first().click();
    await expect(palette).toBeHidden();
}

async function expectNoNetworkLabels(page, label) {
    const visibleText = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const text = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const parent = node.parentElement;
            if (!parent) continue;
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const intersectsViewport = [...range.getClientRects()].some((rect) => (
                rect.bottom > 0
                && rect.right > 0
                && rect.top < window.innerHeight
                && rect.left < window.innerWidth
            ));
            if (intersectsViewport) text.push(node.textContent.trim());
        }
        return text.join(' ');
    });
    expect(visibleText, `${label}: visible text exposes a non-mainnet label`)
        .not.toMatch(NETWORK_LABEL_RE);
    await expect(
        page.getByText('Demo wallet: read-only', { exact: false }),
        `${label}: the demo read-only banner is present`,
    ).toHaveCount(0);
}

async function expectCompactSingleRowHeader(page, label) {
    const header = page.getByRole('region', { name: 'App header' });
    await expect(header).toBeVisible();
    await expect(header.getByRole('img', { name: 'XChain Wallet' })).toBeVisible();

    const geometry = await header.evaluate((element) => {
        const visibleBox = (node) => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden'
                || box.width === 0 || box.height === 0) return null;
            return box;
        };
        const logo = element.querySelector('img');
        const logoBox = logo ? visibleBox(logo) : null;
        const buttons = [...element.querySelectorAll('button')].flatMap((button) => {
            const box = visibleBox(button);
            if (!box) return [];
            return [{
                name: button.getAttribute('aria-label')
                    || button.getAttribute('title')
                    || button.textContent.trim(),
                centreY: box.top + box.height / 2,
            }];
        });
        const headerBox = element.getBoundingClientRect();
        return {
            height: headerBox.height,
            logoCentreY: logoBox ? logoBox.top + logoBox.height / 2 : null,
            buttons,
        };
    });

    expect(geometry.buttons.length, `${label}: the app header has no visible buttons`)
        .toBeGreaterThan(0);
    expect(geometry.logoCentreY, `${label}: the app header logo has no measurable box`)
        .not.toBeNull();
    expect(geometry.height, `${label}: header is ${geometry.height}px tall`)
        .toBeLessThanOrEqual(MAX_HEADER_HEIGHT_PX);
    for (const button of geometry.buttons) {
        const offset = Math.abs(button.centreY - geometry.logoCentreY);
        expect(offset, `${label}: ${button.name} is ${offset}px off the logo row`)
            .toBeLessThanOrEqual(MAX_ROW_OFFSET_PX);
    }
}

async function expectCleanShell(page, label) {
    await page.getByRole('main').evaluate((main) => { main.scrollTop = 0; });
    await settle(page);
    await expectNoNetworkLabels(page, label);
    await expectCompactSingleRowHeader(page, label);
}

test('a regtest demo wallet keeps network state and demo status out of the shell', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        for (const route of TOP_LEVEL_ROUTES) {
            const label = `${route.name} at ${viewport.width}x${viewport.height}`;
            await test.step(label, async () => {
                if (route.paletteName) await gotoPaletteRoute(page, route.paletteName);
                else await gotoSection(page, route.name);
                await expectCleanShell(page, label);
            });
        }

        for (const subpage of SETTINGS_SUBPAGES) {
            const label = `Settings / ${subpage} at ${viewport.width}x${viewport.height}`;
            await test.step(label, async () => {
                await gotoSection(page, 'Settings');
                const row = page.getByRole('main').getByRole('button', {
                    name: new RegExp(`^${escapeRegExp(subpage)}\\b`),
                });
                await row.scrollIntoViewIfNeeded();
                await row.click();
                await expect(page.getByRole('heading', { name: subpage, exact: true })).toBeVisible();
                await expectCleanShell(page, label);
                await page.getByRole('button', { name: 'Back to settings' }).click();
            });
        }
    }
});
