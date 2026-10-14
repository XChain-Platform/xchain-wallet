// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for build gates that resolve repository-owned inputs from their own
// location, allowing release tooling to invoke them from any working directory.

import { strict as assert } from 'node:assert';
import {
    cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'xchain-build-gates-cwd-'));
const outsideCwd = mkdtempSync(join(tmpdir(), 'xchain-build-gates-caller-'));
const fixtureTools = join(fixtureRoot, 'tools', 'build-reproduce');

function run(script) {
    const result = spawnSync('bash', [join(fixtureTools, script)], {
        cwd: outsideCwd,
        encoding: 'utf8',
    });
    if (result.error) throw result.error;
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

try {
    mkdirSync(fixtureTools, { recursive: true });
    for (const script of ['check-no-dev-mock.sh', 'check-no-trezor-dist.sh']) {
        cpSync(join(wsRoot, 'tools', 'build-reproduce', script), join(fixtureTools, script));
    }

    const bundles = {
        'packages/web/dist/app.js': 'throw new Error("CONTRACT_LINT_FAILED");\n',
        'packages/extension/dist/app.js': 'throw new Error("ENCODER_NOT_CONFIGURED");\n',
        'packages/desktop/renderer/dist/app.js': 'throw new Error("SDKWalletError");\n',
        'packages/desktop/main/index.js': 'export {};\n',
    };
    for (const [relativePath, contents] of Object.entries(bundles)) {
        const fullPath = join(fixtureRoot, relativePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, contents);
    }

    let result = run('check-no-dev-mock.sh');
    assert.equal(result.code, 0,
        `dev-mock gate resolves its repository from outside it:\n${result.out}`);
    assert.match(result.out, /OK - 3 bundle\(s\) scanned/,
        'dev-mock gate scans all three fixture bundles');

    result = run('check-no-trezor-dist.sh');
    assert.equal(result.code, 0,
        `Trezor gate resolves its repository from outside it:\n${result.out}`);
    assert.match(result.out, /OK - no @trezor scope tokens/,
        'Trezor gate scans the clean fixture bundles');
} finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(outsideCwd, { recursive: true, force: true });
}

console.log('OK - build gates cwd smoke (scripts resolve their repository roots)');
