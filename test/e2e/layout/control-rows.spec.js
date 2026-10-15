// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../fixtures/wallet.js';
import { createSweep, measureControlRows } from './sweep.js';

const OUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', 'control-rows');

test('controls sharing a row use consistent dimensions and type', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
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
        venue: testInfo.project.name,
        outDir: resolve(OUT_ROOT, testInfo.project.name),
        onScreen,
    });

    await sweep.onboarding();
    await sweep.unlocked();

    expect(auditErrors, 'control-row audit errors').toEqual([]);
    expect(findings, 'inconsistent control rows').toEqual([]);
});
