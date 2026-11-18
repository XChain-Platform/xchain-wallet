// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    gotoSection,
    test,
} from '../../fixtures/wallet.js';
import { switchToRegtest } from '../../fixtures/regtest.js';

const PASSWORD = 'balance-hero-text-password';

const VIEWPORTS = [
    { name: 'phone', width: 360, height: 800, maxLines: 2 },
    { name: 'desktop', width: 1280, height: 800, maxLines: 1 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

// A resize to a desktop width moves the hero into wide Home's split layout,
// which mounts a new hero, and on a slow runner Home can show its loading
// rows while it does. That remount can land between Playwright resolving the
// sentence and reading it: a detached node has no computed font size (NaN)
// and a hidden one has no lines. So the read repeats until it lands on a node
// that is in the page and rendered; every assertion then runs on that reading.
async function textMetrics(amount) {
    let metrics = null;
    await expect.poll(async () => {
        metrics = await readTextMetrics(amount);
        return metrics.live;
    }, { message: 'the hero sentence was read from a rendered node in the page' }).toBe(true);
    return metrics;
}

async function readTextMetrics(amount) {
    return amount.evaluate((element) => {
        if (!element.isConnected || element.getClientRects().length === 0) return { live: false };
        const text = element.querySelector('span');
        const range = document.createRange();
        range.selectNodeContents(text);
        const lineTops = new Set([...range.getClientRects()]
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => Math.round(rect.top * 10) / 10));

        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden';
        document.body.appendChild(probe);
        const resolveSize = (token) => {
            probe.style.fontSize = `var(${token})`;
            return Number.parseFloat(getComputedStyle(probe).fontSize);
        };
        const metrics = {
            live: true,
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
            bodyFontSize: resolveSize('--xc-type-body-size'),
            secondaryFontSize: resolveSize('--xc-text-lg'),
            lineCount: lineTops.size,
        };
        probe.remove();
        return metrics;
    });
}

// The overlap reading counts the live, rendered buttons it measured, so a
// read that lands on a hero mid-remount (every button detached, no boxes)
// retries instead of passing with nothing measured.
async function buttonsOverlappingLabel(hero, label) {
    let reading = { names: [], measured: 0 };
    await expect.poll(async () => {
        const labelBox = await label.boundingBox();
        if (!labelBox) return 0;
        reading = await hero.getByRole('button').evaluateAll((buttons, target) => {
            const names = [];
            let measured = 0;
            for (const button of buttons) {
                if (!button.isConnected) continue;
                const style = getComputedStyle(button);
                const box = button.getBoundingClientRect();
                if (style.display === 'none' || style.visibility === 'hidden'
                    || box.width === 0 || box.height === 0) continue;
                measured += 1;
                const intersects = box.left < target.x + target.width
                    && box.right > target.x
                    && box.top < target.y + target.height
                    && box.bottom > target.y;
                if (intersects) names.push(button.getAttribute('aria-label') || button.textContent.trim() || '<unnamed>');
            }
            return { names, measured };
        }, labelBox);
        return reading.measured;
    }, { message: 'the hero label and its buttons were measured on a rendered hero' }).toBeGreaterThan(0);
    return reading.names;
}

test('balance hero sentences stay secondary and clear of actions', async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    // Demo wallets price their sample holdings, so the unpriced sentence comes
    // from an ordinary wallet on a test network. The shell shows no demo or
    // network status chips (operator ruling).
    await createWallet(page, { password: PASSWORD, name: 'Unpriced hero wallet' });
    await switchToRegtest(page, PASSWORD);
    await gotoSection(page, 'Home');

    const hero = page.getByRole('region', { name: 'Unpriced hero wallet' });
    const amount = hero.locator([
        '[aria-label="Price unavailable"]',
        '[aria-label="Test coins have no value"]',
    ].join(', '));
    const label = hero.getByText(/^(?:Wallet value|Wallet balance)$/);

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await settle(page);
            await expect(amount).toBeVisible();

            const metrics = await textMetrics(amount);
            expect(
                [metrics.bodyFontSize, metrics.secondaryFontSize],
                `${viewport.name}: sentence uses ${metrics.fontSize}px text`,
            ).toContain(metrics.fontSize);
            expect(metrics.fontSize, `${viewport.name}: sentence uses the 32px amount size`)
                .not.toBe(32);
            expect(metrics.lineCount, `${viewport.name}: sentence has no rendered line`)
                .toBeGreaterThan(0);
            expect(metrics.lineCount, `${viewport.name}: sentence wraps to too many lines`)
                .toBeLessThanOrEqual(viewport.maxLines);

            expect(
                await buttonsOverlappingLabel(hero, label),
                `${viewport.name}: a hero button overlaps its label`,
            ).toEqual([]);
        });
    }
});
