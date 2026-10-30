// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The UI rulings gate. Walks every screen the layout sweep reaches, at a
// phone and a desktop size, and counts each screen's findings against the
// operator's UI rulings (see ../../layout/rulings-gate.js for the keys):
// the measureRulings keys, sideways page scroll, unreachable content, a
// header or navigation that scrolls away, and lists short of the content
// width. A count above what rulings.allowlist.json holds for that screen
// fails. The allowlist is the open UI debt: it only shrinks
// (test/unit/layout/rulingsAllowlist.test.js), and a fix that clears a
// screen takes its entry off.
//
// RULINGS_SEED=<dir> writes each venue's counts to <dir>/<venue>.json and
// skips the assertion; ../../layout/seed-rulings-allowlist.mjs folds runs
// into the allowlist.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../../fixtures/wallet.js';
import { createSweep } from '../../layout/sweep.js';
import { allowlistOverruns, allowlistSlack, countRulings } from '../../layout/rulings-gate.js';

const allowlist = JSON.parse(readFileSync(new URL('./rulings.allowlist.json', import.meta.url), 'utf8'));
const SEED_DIR = process.env.RULINGS_SEED || '';

const VENUES = [
    { name: 'phone-360', viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
    { name: 'desktop-1280', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
];

for (const venue of VENUES) {
    test.describe(`UI rulings at ${venue.name}`, () => {
        test.use({ viewport: venue.viewport, isMobile: venue.isMobile, hasTouch: venue.hasTouch });

        test(`every screen holds to the UI rulings at ${venue.name}`, async ({ page }, testInfo) => {
            test.setTimeout(40 * 60 * 1000);
            const screens = [];
            const sweep = createSweep(page, {
                venue: venue.name,
                outDir: testInfo.outputPath('sweep'),
                rulings: true,
                screenshots: false,
                onResult: (result) => screens.push(result),
            });
            // Demo mode: the walk reaches every unlocked screen without a
            // vault, so no key derivation runs.
            await sweep.onboarding({ demo: true });
            await sweep.unlocked();

            expect(screens.length, 'harness coverage: the walk measured screens').toBeGreaterThan(20);
            const unmeasured = screens.filter((s) => s.error || s.rulingsError).map((s) => `${s.label}: ${s.error || s.rulingsError}`);
            expect(unmeasured, 'every screen was measured').toEqual([]);

            const counts = countRulings(venue.name, screens);
            if (SEED_DIR) {
                mkdirSync(SEED_DIR, { recursive: true });
                writeFileSync(join(SEED_DIR, `${venue.name}.json`), `${JSON.stringify(counts, null, 1)}\n`);
                return;
            }
            const slack = allowlistSlack(counts, allowlist, venue.name);
            if (slack.length) {
                testInfo.annotations.push({ type: 'allowlist can shrink', description: slack.join('\n') });
            }
            expect(allowlistOverruns(counts, allowlist), 'findings beyond rulings.allowlist.json').toEqual([]);
        });
    });
}
