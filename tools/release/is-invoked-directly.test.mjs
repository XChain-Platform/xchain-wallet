// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const releaseDir = dirname(fileURLToPath(import.meta.url));

test('a renamed launch-probe symlink still runs the CLI', () => {
    const work = mkdtempSync(join(tmpdir(), 'release-entry-alias-'));
    const alias = join(work, 'launch-check');
    symlinkSync(join(releaseDir, 'launch-probe.mjs'), alias);
    const result = spawnSync(process.execPath, [alias, join(work, 'missing'), '--require-probed', '1'], {
        encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /launch-probe: cannot list/);
});

test('release tools do not use filename-suffix entry guards', () => {
    const offenders = readdirSync(releaseDir)
        .filter((name) => name.endsWith('.mjs'))
        .filter((name) => /process\.argv\[1\]\s*\.endsWith\(/.test(readFileSync(join(releaseDir, name), 'utf8')));
    assert.deepEqual(offenders, []);
});
