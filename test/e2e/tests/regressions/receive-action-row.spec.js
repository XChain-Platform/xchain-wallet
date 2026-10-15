// Copyright (c) 2026 Dankest, LLC
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
    { width: 360, height: 800 },
    { width: 412, height: 869 },
    { width: 1280, height: 800 },
];

test('Receive action labels stay on one standard-height line inside the viewport', async ({ page }) => {
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width} by ${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            await gotoSection(page, 'Receive');

            const newAddress = page.getByRole('main')
                .getByRole('button', { name: 'Generate new address' });
            await expect(newAddress).toBeVisible();

            const actionRow = newAddress.locator('..');
            const actions = actionRow.locator(':scope > button, :scope > a');
            await expect(actions).toHaveCount(4);

            const metrics = await actions.evaluateAll((controls) => {
                const standardHeight = Number.parseFloat(
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--xc-control-h-md'),
                );
                const viewportWidth = document.documentElement.clientWidth;
                return {
                    standardHeight,
                    viewportWidth,
                    controls: controls.map((control) => {
                        const box = control.getBoundingClientRect();
                        return {
                            label: control.innerText.trim().replace(/\s+/g, ' '),
                            clientHeight: control.clientHeight,
                            scrollHeight: control.scrollHeight,
                            height: box.height,
                            left: box.left,
                            right: box.right,
                        };
                    }),
                };
            });

            expect(metrics.standardHeight, 'the medium control height token must resolve')
                .toBeGreaterThan(0);
            expect(
                new Set(metrics.controls.map(({ height }) => height)).size,
                `${viewport.width}px: Receive actions have different heights`,
            ).toBe(1);

            for (const control of metrics.controls) {
                const label = `${viewport.width}px: ${control.label}`;
                expect(
                    control.scrollHeight,
                    `${label} wraps or clips vertically`,
                ).toBe(control.clientHeight);
                expect(
                    control.height,
                    `${label} does not use the standard medium control height`,
                ).toBe(metrics.standardHeight);
                expect(control.left, `${label} overflows the viewport start`).toBeGreaterThanOrEqual(0);
                expect(control.right, `${label} overflows the viewport end`)
                    .toBeLessThanOrEqual(metrics.viewportWidth);
            }
        });
    }
});
