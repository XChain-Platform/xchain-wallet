// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    readRecoveryPhrase,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORT = { width: 360, height: 800 };
const LONGEST_LOCALE = 'en';
const PASSWORD = 'long-label-wrap-1234';

async function settle(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

async function measureLongLabelLayout(page) {
    return page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const visible = (element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity) !== 0
                && box.width > 0
                && box.height > 0;
        };
        const describe = (element) => ({
            tag: element.tagName.toLowerCase(),
            text: (element.getAttribute('aria-label') || element.textContent || '')
                .trim().replace(/\s+/g, ' ').slice(0, 100),
        });

        const buttonLabels = [];
        const seenButtonLabels = new Set();
        for (const button of document.querySelectorAll('button, [role="button"]')) {
            for (const element of [button, ...button.querySelectorAll('*')]) {
                if (!(element instanceof HTMLElement)
                    || seenButtonLabels.has(element)
                    || !visible(element)) continue;
                seenButtonLabels.add(element);
                const text = (element.textContent || '').trim();
                if (!text || element.scrollWidth <= element.clientWidth + 1) continue;
                buttonLabels.push({
                    ...describe(element),
                    clientWidth: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                });
            }
        }

        const cardText = [];
        const seenCardText = new Set();
        const cardSelector = [
            'article',
            'fieldset',
            '[class*="card" i]',
            '[class*="panel" i]',
            '[class*="surface" i]',
        ].join(', ');
        for (const card of document.querySelectorAll(cardSelector)) {
            if (!visible(card)) continue;
            const cardBox = card.getBoundingClientRect();
            const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node.textContent.trim().replace(/\s+/g, ' ');
                const parent = node.parentElement;
                if (!text || !parent || parent.closest('svg, [aria-hidden="true"]') || !visible(parent)) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const textBox = range.getBoundingClientRect();
                if (textBox.width === 0 || textBox.height === 0) continue;
                if (textBox.left >= cardBox.left - 1 && textBox.right <= cardBox.right + 1) continue;
                const key = `${text}|${Math.round(cardBox.left)}|${Math.round(cardBox.right)}`;
                if (seenCardText.has(key)) continue;
                seenCardText.add(key);
                cardText.push({
                    text: text.slice(0, 100),
                    card: describe(card),
                    left: Math.round(textBox.left),
                    right: Math.round(textBox.right),
                    cardLeft: Math.round(cardBox.left),
                    cardRight: Math.round(cardBox.right),
                });
            }
        }

        const controls = [];
        const controlSelector = [
            'button',
            'a[href]',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            'summary',
            '[role="button"]',
            '[role="checkbox"]',
            '[role="combobox"]',
            '[role="radio"]',
            '[role="slider"]',
            '[role="switch"]',
            '[role="tab"]',
        ].join(', ');
        for (const control of document.querySelectorAll(controlSelector)) {
            if (!visible(control)) continue;
            const box = control.getBoundingClientRect();
            if (box.left >= -1 && box.right <= viewportWidth + 1) continue;
            controls.push({
                ...describe(control),
                left: Math.round(box.left),
                right: Math.round(box.right),
                viewportWidth,
            });
        }

        const root = document.documentElement;
        return {
            buttonLabels,
            cardText,
            controls,
            documentOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
        };
    });
}

async function expectLongLabelsFit(page, label) {
    await expect(
        page.locator('html'),
        `${label}: the app did not load the largest available locale`,
    ).toHaveAttribute('lang', LONGEST_LOCALE);
    await settle(page);

    const report = await measureLongLabelLayout(page);
    expect(report.buttonLabels, `${label}: button labels are clipped`).toEqual([]);
    expect(report.cardText, `${label}: text overflows its card`).toEqual([]);
    expect(report.controls, `${label}: controls extend outside the viewport`).toEqual([]);
    expect(report.documentOverflow, `${label}: the document scrolls horizontally`).toBe(0);
}

async function returnToWelcome(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
}

test.describe('long labels at 360px', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize(VIEWPORT);
    });

    test('Home, Send, and Settings wrap the longest available locale', async ({ page }) => {
        test.slow();
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        for (const route of ['Home', 'Send', 'Settings']) {
            await test.step(route, async () => {
                await gotoSection(page, route);
                await expect(page.getByRole('main')).toBeVisible();
                await expectLongLabelsFit(page, route);
            });
        }
    });

    test('every onboarding screen wraps the longest available locale', async ({ page }) => {
        await page.goto('/');

        const carousel = page.getByTestId('onboarding-carousel');
        const welcome = page.getByRole('button', { name: 'Create new wallet' });
        await carousel.or(welcome).first().waitFor({ state: 'visible', timeout: 60_000 });
        if (await carousel.isVisible()) {
            const steps = carousel.getByRole('tab');
            const count = await steps.count();
            if (count === 0) {
                await expectLongLabelsFit(page, 'onboarding explainer');
            } else {
                for (let index = 0; index < count; index += 1) {
                    await steps.nth(index).click();
                    await expectLongLabelsFit(page, `onboarding explainer step ${index + 1}`);
                }
            }
            await carousel.getByRole('button', { name: 'Skip' }).click();
        }

        await expect(welcome).toBeVisible();
        await expectLongLabelsFit(page, 'onboarding welcome');

        await welcome.click();
        const next = page.getByRole('button', { name: 'Next' });
        await expect(next).toBeVisible();
        await expectLongLabelsFit(page, 'onboarding password');
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
        await next.click();

        const words = await readRecoveryPhrase(page);
        expect(words).toHaveLength(12);
        await expectLongLabelsFit(page, 'onboarding recovery phrase');
        await page.getByLabel(/written down|saved my recovery phrase/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
        await expect(page.getByRole('button', { name: 'Create wallet' })).toBeVisible();
        await expectLongLabelsFit(page, 'onboarding phrase verification');

        await returnToWelcome(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
        await expectLongLabelsFit(page, 'onboarding recovery phrase import');
        await page.getByRole('tab', { name: 'Encrypted backup' }).click();
        await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
        await expectLongLabelsFit(page, 'onboarding encrypted backup import');

        await returnToWelcome(page);
        await page.getByRole('button', { name: 'From FreeWallet' }).click();
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
        await expectLongLabelsFit(page, 'onboarding FreeWallet import');
    });
});
