// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweep } from '../../../tools/release/feed-sweep.mjs';

const scratchRoot = tmpdir();

function buildFeed(gate) {
    const root = mkdtempSync(join(scratchRoot, `android-gate-${gate}-`));
    for (const dir of ['desktop', 'extension', 'web', 'android', 'RELEASE_HASHES']) {
        mkdirSync(join(root, dir));
    }
    const manifest = [
        '# XChain Wallet release manifest',
        '# manifest-version: 1',
        '# tag: v1.2.3',
        `# dev-mock-gate: ${gate}`,
        '# artifacts: 0',
        '',
    ].join('\n');
    writeFileSync(join(root, 'RELEASE_HASHES/v1.2.3.txt'), manifest);
    writeFileSync(join(root, 'RELEASE_HASHES/v1.2.3.txt.asc'), 'test signature');
    writeFileSync(join(root, 'android/latest.json'), '{"version":"1.2.3"}\n');
    return root;
}

const skipped = sweep(buildFeed('SKIPPED'));
assert.deepEqual(skipped.findings.map((finding) => finding.code), ['POINTER-UNGATED']);
assert.equal(skipped.findings[0].path, 'android/latest.json');

const enforced = sweep(buildFeed('enforced'));
assert.deepEqual(enforced.findings, [], 'an enforced Android pointer remains clean');

process.stdout.write('OK: feed sweep Android gate smoke\n');
