// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A screen never repeats a title or a help line (UI ruling U18). The
// measurement reads every heading, paragraph, title, help and hint element
// that a person can see and reports text that appears twice. Values in
// separate rows of one list are row data and pass. The walk runs on the web
// dev server at a phone and a desktop size, and no screen may repeat text.

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import {
    dismissIntroCarousel, expect, test, unlockedShell,
} from '../../fixtures/wallet.js';
import { createSweep, measureRulings } from '../../layout/sweep.js';
import { repeatedTextFailures } from '../../layout/rulings-gate.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const VIEWPORTS = [
    { name: 'phone 360x780', viewport: { width: 360, height: 780 } },
    { name: 'desktop 1280x800', viewport: { width: 1280, height: 800 } },
];

test('a title repeated on one screen fails the repeated text check', async ({ page }) => {
    await page.setContent('<main><h1>Backup</h1><p>Back up your wallet</p></main>');
    expect(repeatedTextFailures('clean', await page.evaluate(measureRulings))).toEqual([]);
    await page.setContent('<main><h1>Backup</h1><h2>Backup</h2><p>Back up your wallet</p></main>');
    const failures = repeatedTextFailures('title', await page.evaluate(measureRulings));
    expect(failures).toEqual(['title: "backup" appears 2 times']);
});

test('a help line repeated on one screen fails the repeated text check', async ({ page }) => {
    await page.setContent('<main><h1>Send</h1><p class="help">Check the address twice</p><p class="hint">Check the address twice</p></main>');
    const failures = repeatedTextFailures('help', await page.evaluate(measureRulings));
    expect(failures).toEqual(['help: "check the address twice" appears 2 times']);
});

test('one subtitle repeated across list rows passes the repeated text check', async ({ page }) => {
    await page.setContent(`<main><h1>Tokens</h1><ul>
        <li><span class="rowTitle">Alpha</span><span class="rowSubtitle">Open this token</span></li>
        <li><span class="rowTitle">Beta</span><span class="rowSubtitle">Open this token</span></li>
    </ul></main>`);
    expect(repeatedTextFailures('rows', await page.evaluate(measureRulings))).toEqual([]);
});

for (const { name, viewport } of VIEWPORTS) {
    test(`no screen repeats a title or help line at ${name}`, async ({ page }) => {
        test.setTimeout(20 * 60 * 1000);
        await page.setViewportSize(viewport);
        const screens = [];
        const sweep = createSweep(page, {
            venue: name,
            outDir: mkdtempSync(join(tmpdir(), 'repeated-text-')),
            rulings: true,
            screenshots: false,
            onResult: (result) => screens.push(result),
        });
        await page.goto('/');
        await sweep.measure('onboarding: intro carousel');
        await dismissIntroCarousel(page);
        await sweep.measure('onboarding: welcome');
        await page.getByRole('button', { name: 'Try in demo mode' }).click();
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
        await sweep.unlocked();
        expect(screens.length, 'the walk measured screens').toBeGreaterThan(10);
        const unmeasured = screens.filter((s) => s.error || s.rulingsError).map((s) => `${s.label}: ${s.error || s.rulingsError}`);
        expect(unmeasured, 'every screen was measured').toEqual([]);
        const failures = screens.flatMap((s) => repeatedTextFailures(s.label, s.rulings || {}));
        expect(failures, 'no screen repeats text').toEqual([]);
    });
}
