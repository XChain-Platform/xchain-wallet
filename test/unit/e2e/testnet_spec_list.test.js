// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

// No other unit test loads the two testnet staking specs (testnet_imports only
// parses them), so a spec that throws at load, a stray test.only, a test.skip
// or test.fixme, or a drifted spec glob would surface only once the live
// testnet pass starts. `playwright test --list` loads every spec but runs
// neither global setup nor the webServer command, so nothing is built, read
// from the venue or spent.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = 'test/e2e/playwright.testnet.config.js';

const EXPECTED = [
    'staking/partial-claim.testnet.spec.js',
    'staking/stake-unstake.testnet.spec.js',
];

function listTestnetSpecs() {
    const env = { ...process.env, CI: '1' };
    delete env.XC_TESTNET_RUN_INPUT;
    return spawnSync(
        process.execPath,
        [CLI, 'test', '--list', '--config', CONFIG, '--reporter=json'],
        {
            cwd: ROOT,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        },
    );
}

function collectTests(suites, found = []) {
    for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) {
            for (const t of spec.tests ?? []) {
                found.push({
                    file: spec.file ?? suite.file,
                    title: spec.title,
                    project: t.projectName,
                    expectedStatus: t.expectedStatus,
                });
            }
        }
        collectTests(suite.suites, found);
    }
    return found;
}

describe('testnet spec collection', () => {
    it('collects the two staking tests, each expected to pass', () => {
        const run = listTestnetSpecs();
        expect(run.error).toBeUndefined();
        expect(run.status, run.stderr).toBe(0);

        const report = JSON.parse(run.stdout);
        expect(report.errors ?? []).toEqual([]);

        const tests = collectTests(report.suites).map((t) => ({
            ...t,
            file: String(t.file).split(path.sep).join('/'),
        }));

        for (const file of EXPECTED) {
            const hits = tests.filter((t) => t.project === 'chromium' && t.file.endsWith(file));
            expect(hits.map((t) => `${t.file}: ${t.title}`), `chromium tests in ${file}`).toHaveLength(1);
        }

        const notPassing = tests
            .filter((t) => t.expectedStatus !== 'passed')
            .map((t) => `${t.file}: ${t.title} (expectedStatus ${t.expectedStatus})`);
        expect(notPassing).toEqual([]);
    }, 180_000);
});
