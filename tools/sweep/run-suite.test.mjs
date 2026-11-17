// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { smokeEnv, smokeNodeArgs } from '../../test/smoke/_smoke-launch.js';
import { runSuite } from './run-suite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const smokeFile = 'test/smoke/audits/sweep-copy-loader.smoke.js';
const smokePath = join(repoRoot, smokeFile);
const rawSourceSmokeFile = 'test/smoke/core/i18n.smoke.js';

test('copy-sensitive smoke passes through full and per-file launchers', async () => {
    const fullLaunch = spawnSync(process.execPath, smokeNodeArgs(smokePath), {
        cwd: repoRoot,
        env: smokeEnv(smokePath),
        encoding: 'utf8',
    });
    assert.equal(fullLaunch.status, 0, fullLaunch.stderr);

    const out = mkdtempSync(join(tmpdir(), 'xchain-run-suite-'));
    const selectedLaunch = await runSuite({
        suite: 'smoke',
        files: [smokeFile, rawSourceSmokeFile],
        out,
    }, { repoRoot });

    assert.deepEqual(
        {
            pass: selectedLaunch.pass,
            fail: selectedLaunch.fail,
            exitCode: selectedLaunch.exitCode,
        },
        { pass: 2, fail: 0, exitCode: 0 },
    );
});
