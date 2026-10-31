// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sweep } from '../../../../tools/release/feed-sweep.mjs';

const root = mkdtempSync(join(tmpdir(), 'xchain-feed-filename-'));
const artifact = 'xchain-wallet-0.336.0.AppImage';
const bytes = 'release bytes';
const sha256 = createHash('sha256').update(bytes).digest('hex');
const sha512 = createHash('sha512').update(bytes).digest('base64');

try {
    for (const dir of ['desktop', 'extension', 'web', 'android', 'RELEASE_HASHES']) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    writeFileSync(join(root, 'desktop', artifact), bytes);
    writeFileSync(join(root, 'desktop', 'stable-linux.yml'), [
        'version: 0.336.0',
        'files:',
        `  - url: ${artifact}`,
        `    sha512: ${sha512}`,
        `path: ${artifact}`,
        `sha512: ${sha512}`,
        '',
    ].join('\n'));
    const wrongName = join(root, 'RELEASE_HASHES', 'v0.336.0-resign1.txt');
    writeFileSync(wrongName, [
        '# tag: v0.336.0-resign1',
        '# dev-mock-gate: enforced',
        `${sha256}  ./${artifact}`,
        '',
    ].join('\n'));
    writeFileSync(`${wrongName}.asc`, 'signature');

    const codes = sweep(root).findings.map((finding) => finding.code);
    assert.ok(codes.includes('MANIFEST-TAG-MISMATCH'));
    assert.ok(codes.includes('POINTER-NO-MANIFEST'));
} finally {
    rmSync(root, { recursive: true, force: true });
}

console.log('manifest-filename.smoke.js: ok');
