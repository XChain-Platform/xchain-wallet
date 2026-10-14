// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 360, height: 800, maxLines: 2 },
    { name: 'desktop', width: 1280, height: 800, maxLines: 1 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function textMetrics(amount) {
    return amount.evaluate((element) => {
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
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
            bodyFontSize: resolveSize('--xc-type-body-size'),
            secondaryFontSize: resolveSize('--xc-text-lg'),
            lineCount: lineTops.size,
        };
        probe.remove();
        return metrics;
    });
}

async function buttonsOverlappingLabel(hero, label) {
    const labelBox = await label.boundingBox();
    expect(labelBox, 'the hero label has no rendered box').not.toBeNull();

    return hero.getByRole('button').evaluateAll((buttons, target) => buttons.flatMap((button) => {
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden'
            || box.width === 0 || box.height === 0) return [];
        const intersects = box.left < target.x + target.width
            && box.right > target.x
            && box.top < target.y + target.height
            && box.bottom > target.y;
        return intersects
            ? [button.getAttribute('aria-label') || button.textContent.trim() || '<unnamed>']
            : [];
    }), labelBox);
}

test('balance hero sentences stay secondary and clear of actions', async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    await expect(page.getByRole('status', { name: 'Demo wallet' })).toBeVisible();
    await expect(page.getByRole('status', { name: /Active network: Regtest/ })).toBeVisible();

    const hero = page.getByRole('region', { name: 'Active address balance' });
    const amount = hero.locator([
        '[aria-label="Price unavailable"]',
        '[aria-label="Test coins have no value"]',
    ].join(', '));
    const label = hero.getByText('Active address balance', { exact: true });

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
