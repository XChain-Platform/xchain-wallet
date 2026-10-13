// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep in the browser venues: one run per project in
// playwright.layout.config.js (Chromium at Android phone sizes, WebKit at
// iPhone and iPad sizes). Results land in tmp/layout-sweep/<project>/.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '../fixtures/wallet.js';
import { createSweep } from './sweep.js';

const OUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', 'layout-sweep');

test('layout sweep', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
    const venue = testInfo.project.name;
    const sweep = createSweep(page, {
        venue,
        outDir: join(OUT_ROOT, venue),
        rootFontSize: testInfo.project.metadata?.rootFontSize,
    });
    await sweep.onboarding();
    await sweep.unlocked();
});
