// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Buttons use the shared Button classes, and a white button on a white
// page shows its edge (UI ruling U13: a visible 1px outline; the operator's
// example was the onboarding import buttons). At a phone and a desktop
// size, in the light palette, on the onboarding welcome and import screens,
// Home, Send and Settings:
//   - every shared Button carries exactly one variant class and one size
//     class, so none is restyled into a look the kit does not have;
//   - every shared Button that paints a box (not ghost, link or icon-only)
//     and is light on a light backdrop draws a solid border at least 1px
//     wide that stands off the backdrop.
//
// BUTTONS_OUTLINE_OUT=<dir> writes each screen's measurements there.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';
import { measureButtons } from '../../layout/button-outlines.js';

const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
];
const OUT = process.env.BUTTONS_OUTLINE_OUT || '';

/** The least contrast between a light button's border and its backdrop that reads as an edge. */
const EDGE_CONTRAST = 1.2;

function buttonFaults(screen, buttons) {
    const faults = [];
    for (const b of buttons) {
        if (!b.shared) continue;
        if (b.variants.length !== 1) faults.push(`${screen}: "${b.name}" has variant classes [${b.variants.join(', ')}]`);
        if (b.sizes.length !== 1) faults.push(`${screen}: "${b.name}" has size classes [${b.sizes.join(', ')}]`);
        const boxed = !b.iconOnly && !b.variants.some((v) => v === 'ghost' || v === 'link');
        if (boxed && b.lightOnLight && b.edgeContrast < EDGE_CONTRAST && !b.shadow) {
            faults.push(`${screen}: white button "${b.name}" shows no outline (border ${b.border}, contrast ${b.edgeContrast})`);
        }
    }
    return faults;
}

for (const viewport of VIEWPORTS) {
    test(`buttons use the shared classes and white buttons show an outline at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.setTimeout(6 * 60 * 1000);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: 'light' });
        const faults = [];
        let measured = 0;
        let boxedLight = 0;
        const record = async (screen) => {
            await page.waitForTimeout(300);
            const buttons = await page.evaluate(measureButtons);
            measured += buttons.filter((b) => b.shared).length;
            boxedLight += buttons.filter((b) => b.shared && b.lightOnLight && !b.iconOnly && !b.variants.some((v) => v === 'ghost' || v === 'link')).length;
            faults.push(...buttonFaults(screen, buttons));
            if (OUT) {
                mkdirSync(OUT, { recursive: true });
                writeFileSync(join(OUT, `${viewport.width}-${screen.replace(/[^a-z0-9]+/gi, '-')}.json`), JSON.stringify(buttons, null, 1));
            }
        };

        await page.goto('/');
        await dismissIntroCarousel(page);
        await record('welcome');
        for (const name of ['Import wallet', 'From FreeWallet']) {
            const opener = page.getByRole('button', { name }).first();
            if (await opener.count() === 0) continue;
            await opener.click();
            await record(`onboarding ${name}`);
            await page.goto('/');
            await dismissIntroCarousel(page);
        }

        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await record('home');
        await gotoSection(page, 'Send');
        await record('send');
        await openSettings(page);
        await record('settings');

        expect(measured, 'harness coverage: shared Buttons measured').toBeGreaterThan(10);
        expect(boxedLight, 'harness coverage: light boxed Buttons measured').toBeGreaterThan(0);
        expect(faults).toEqual([]);
    });
}

test('the outline rule reads a borderless white button as a fault', async ({ page }) => {
    await page.setContent(`
        <style>body { background: #fff; } button { background: #fff; padding: 8px 16px; }</style>
        <button class="_btn_x1_1 _secondary_x1_2 _md_x1_3" style="border: 1px solid #fff">Bare</button>
        <button class="_btn_x1_1 _secondary_x1_2 _md_x1_3" style="border: 1px solid #8a8f98">Outlined</button>
        <button class="_btn_x1_1 _ghost_x1_4 _md_x1_3" style="border: 0">Ghost</button>
        <button class="_btn_x1_1 _secondary_x1_2 _primary_x1_5 _md_x1_3" style="border: 1px solid #8a8f98">Two looks</button>
    `);
    const faults = buttonFaults('fixture', await page.evaluate(measureButtons));
    expect(faults).toEqual([
        'fixture: white button "Bare" shows no outline (border 1px solid rgb(255, 255, 255), contrast 1)',
        'fixture: "Two looks" has variant classes [primary, secondary]',
    ]);
});
