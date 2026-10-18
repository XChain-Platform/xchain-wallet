// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import AxeBuilder from '@axe-core/playwright';
import {
    dismissIntroCarousel,
    expect,
    freezeMotion,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const THEMES = ['light', 'dark'];
const ROUTES = ['Home', 'Send', 'Receive', 'History', 'Settings'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

test.use({ viewport: { width: 360, height: 800 } });

async function expectContrast(page, label) {
    const { violations } = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .analyze();
    const blocking = violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact));

    expect(
        blocking.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            targets: violation.nodes.map((node) => node.target.join(' ')),
        })),
        `${label} has serious or critical color contrast violations`,
    ).toEqual([]);
}

test('demo wallet routes meet color contrast requirements in light and dark themes', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await freezeMotion(page);

    for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        expect(
            await page.evaluate((value) => window.matchMedia(`(prefers-color-scheme: ${value})`).matches, theme),
            `${theme} color scheme emulation is active`,
        ).toBe(true);

        for (const route of ROUTES) {
            await test.step(`${theme} / ${route}`, async () => {
                await gotoSection(page, route);
                await expect(page.getByRole('heading', { level: 1, name: route, exact: true }))
                    .toHaveCount(1);
                await expectContrast(page, `${theme} theme / ${route}`);
            });
        }
    }
});

// Tinted fills sit under accent and danger text only on these surfaces: the
// DeFi confirmation pill, the More sheet's hovered destructive row and the
// palette's hovered link row. The route loop above never opens them.
test('tinted pills, hovered rows and sheets meet color contrast in light and dark themes', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await freezeMotion(page);

    for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });

        await test.step(`${theme} / DeFi tab`, async () => {
            await gotoSection(page, 'Home');
            await page.getByRole('tab', { name: 'DeFi' }).or(page.getByRole('button', { name: 'DeFi', exact: true })).first().click();
            await expectContrast(page, `${theme} theme / DeFi tab`);
        });

        await test.step(`${theme} / More sheet`, async () => {
            const more = page.getByRole('button', { name: 'More', exact: true });
            if (await more.count() === 0) return; // the rail has no sheet
            await more.first().click();
            const lock = page.getByRole('button', { name: 'Lock wallet' }).last();
            await lock.hover();
            await expectContrast(page, `${theme} theme / More sheet`);
            await page.keyboard.press('Escape');
        });
    }
});
