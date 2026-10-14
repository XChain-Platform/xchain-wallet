// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Axe sweep: the layout sweep's walk with an axe-core audit of every screen it
// reaches. Writes tmp/axe-sweep/<run>/violations.json (every violation by
// screen) and summary.json (counts by rule). Findings are for a person to
// judge, so the test never fails on a violation. Run with
// playwright.axe.config.js; AXE_RUN names the output folder (default "latest").

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/wallet.js';
import { freezeMotion } from '../fixtures/wallet.js';
import { WCAG_TAGS } from '../fixtures/a11y.js';
import { createSweep } from './sweep.js';

const OUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', 'axe-sweep');

test('axe sweep', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
    const outDir = join(OUT_ROOT, process.env.AXE_RUN || 'latest');
    mkdirSync(outDir, { recursive: true });
    const screens = [];

    // Best-practice rules ride along: heading order and duplicate ids are the
    // checks the WCAG-only tags leave out.
    const onScreen = async (p, label) => {
        await freezeMotion(p);
        const { violations } = await new AxeBuilder({ page: p }).withTags([...WCAG_TAGS, 'best-practice']).analyze();
        screens.push({
            label,
            violations: violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                help: v.help,
                nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), why: (n.any[0] || n.all[0] || n.none[0] || {}).message })),
            })),
        });
        return { axe: violations.length };
    };

    const sweep = createSweep(page, { venue: testInfo.project.name, outDir, onScreen });
    await sweep.onboarding();
    await sweep.unlocked();

    const byRule = {};
    for (const s of screens) {
        for (const v of s.violations) {
            const r = byRule[v.id] || (byRule[v.id] = { impact: v.impact, help: v.help, nodes: 0, screens: [] });
            r.nodes += v.nodes.length;
            r.screens.push(s.label);
        }
    }
    writeFileSync(join(outDir, 'violations.json'), JSON.stringify(screens, null, 1));
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ screens: screens.length, byRule }, null, 1));
});
