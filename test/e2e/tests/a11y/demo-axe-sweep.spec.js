// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Demo-mode axe sweep: the layout sweep's unlocked walk (home tabs, header
// popovers, every command-palette destination, the menu, every Settings
// section, the More sheet) with an axe audit of each screen, in light and
// dark at 360x800 and 1280x800. Any serious or critical violation fails the
// run. Writes tmp/a11y-sweep/<combo>.json. Run with
// playwright.a11y-sweep.config.js.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { dismissIntroCarousel, expect, freezeMotion, test, unlockedShell } from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';
import { WCAG_TAGS } from '../../fixtures/a11y.js';
import { createSweep } from '../../layout/sweep.js';

const OUT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', 'tmp', 'a11y-sweep');
const BLOCKING = new Set(['serious', 'critical']);
const SIZES = [{ w: 360, h: 800 }, { w: 1280, h: 800 }];
const THEMES = ['light', 'dark'];

for (const size of SIZES) {
    for (const theme of THEMES) {
        test(`demo axe sweep ${size.w}x${size.h} ${theme}`, async ({ page }) => {
            test.setTimeout(30 * 60 * 1000);
            mkdirSync(OUT, { recursive: true });
            await page.setViewportSize({ width: size.w, height: size.h });
            await page.emulateMedia({ colorScheme: theme });
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

            const found = [];
            const onScreen = async (p, label) => {
                await freezeMotion(p);
                const { violations } = await new AxeBuilder({ page: p }).withTags(WCAG_TAGS).analyze();
                for (const v of violations) {
                    if (!BLOCKING.has(v.impact)) continue;
                    found.push({
                        label,
                        id: v.id,
                        impact: v.impact,
                        nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${(n.any[0] || n.all[0] || n.none[0] || {}).message}`),
                    });
                }
                return {};
            };
            const sweep = createSweep(page, { venue: `${size.w}-${theme}`, outDir: join(OUT, `${size.w}-${theme}`), onScreen });
            await sweep.unlocked();
            writeFileSync(join(OUT, `${size.w}-${theme}.json`), JSON.stringify(found, null, 1));
            expect(found.map((f) => `${f.label}: ${f.id} ${f.nodes[0]}`), 'serious or critical axe violations').toEqual([]);
        });
    }
}
