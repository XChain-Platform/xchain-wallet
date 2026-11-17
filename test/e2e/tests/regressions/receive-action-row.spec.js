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

// The QR's actions are one ActionList under the code (ruling G101): Copy,
// Share, the explorer and New address, a full-width row each with a title
// and a one-line description, never a row of short buttons.
test('Receive actions are one full-width action list inside the viewport', async ({ page }) => {
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width} by ${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            await gotoSection(page, 'Receive');

            const list = page.getByRole('main')
                .getByRole('list', { name: 'Payment request actions' });
            await expect(list).toBeVisible();
            await expect(list.getByRole('button', { name: /^Generate new address/ })).toBeVisible();

            const rows = list.locator(':scope > li > button, :scope > li > a');
            const count = await rows.count();
            expect(count, `${viewport.width}px: Receive has too few action rows`).toBeGreaterThanOrEqual(3);

            const metrics = await rows.evaluateAll((controls) => {
                const viewportWidth = document.documentElement.clientWidth;
                const listBox = controls[0]?.closest('ul')?.getBoundingClientRect();
                return {
                    viewportWidth,
                    listWidth: listBox?.width ?? 0,
                    controls: controls.map((control) => {
                        const box = control.getBoundingClientRect();
                        return {
                            label: control.innerText.trim().split('\n')[0],
                            lines: control.innerText.trim().split('\n').filter(Boolean).length,
                            scrollWidth: control.scrollWidth,
                            clientWidth: control.clientWidth,
                            width: box.width,
                            left: box.left,
                            right: box.right,
                        };
                    }),
                };
            });

            for (const control of metrics.controls) {
                const label = `${viewport.width}px: ${control.label}`;
                expect(control.lines, `${label} has no description line`).toBeGreaterThanOrEqual(2);
                expect(control.width, `${label} does not fill the list's width`)
                    .toBe(metrics.listWidth);
                expect(control.scrollWidth, `${label} clips sideways`)
                    .toBeLessThanOrEqual(control.clientWidth);
                expect(control.left, `${label} overflows the viewport start`).toBeGreaterThanOrEqual(0);
                expect(control.right, `${label} overflows the viewport end`)
                    .toBeLessThanOrEqual(metrics.viewportWidth);
            }
        });
    }
});
