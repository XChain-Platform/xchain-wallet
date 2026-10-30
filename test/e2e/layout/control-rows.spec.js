// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Ruling U07: controls sharing a row line up. Walks every screen the layout
// sweep reaches and counts each screen's mismatched control rows against
// control-rows.allowlist.json, which only shrinks. Runs in the default suite
// (projects control-rows-360, -768 and -1280 in playwright.config.js) and on
// its own through playwright.control-rows.config.js; the per-screen results
// (and, on a standalone run, a screenshot per screen) land in the test's
// output directory under sweep/.

import { readFileSync } from 'node:fs';
import { expect, test } from '../fixtures/wallet.js';
import { createSweep, measureControlRows } from './sweep.js';
import { controlRowOverruns, controlRowSlack, countControlRows } from './control-rows-gate.js';

const allowlist = JSON.parse(readFileSync(new URL('./control-rows.allowlist.json', import.meta.url), 'utf8'));

test('controls sharing a row use consistent dimensions and type', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
    const venue = testInfo.project.name;
    const findings = [];
    const auditErrors = [];
    const onScreen = async (currentPage, label) => {
        try {
            const controlRows = await currentPage.evaluate(measureControlRows);
            findings.push(...controlRows.map((finding) => ({ route: label, ...finding })));
            return { controlRows };
        } catch (error) {
            auditErrors.push({ route: label, error: String(error?.message || error) });
            return { controlRowError: String(error?.message || error) };
        }
    };
    const sweep = createSweep(page, {
        venue,
        outDir: testInfo.outputPath('sweep'),
        onScreen,
        // A screenshot per screen is for reading a standalone run; the
        // default suite keeps only the per-screen results.
        screenshots: /playwright\.control-rows\.config\.js$/.test(testInfo.config.configFile || ''),
    });

    await sweep.onboarding();
    await sweep.unlocked();

    expect(auditErrors, 'control-row audit errors').toEqual([]);
    const counts = countControlRows(venue, findings);
    const slack = controlRowSlack(counts, allowlist, venue);
    if (slack.length) {
        testInfo.annotations.push({ type: 'allowlist can shrink', description: slack.join('\n') });
    }
    const overruns = controlRowOverruns(counts, allowlist);
    const detail = findings.filter((finding) => overruns.some((line) => line.startsWith(`${venue} | ${finding.route}:`)));
    expect({ overruns, detail }, 'control rows beyond control-rows.allowlist.json').toEqual({ overruns: [], detail: [] });
});
