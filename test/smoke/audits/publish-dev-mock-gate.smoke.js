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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(root, 'tools/release/publish.sh'), 'utf8');
const verifyAt = source.indexOf('bash "$HERE/verify.sh" --input "$INPUT_DIR" --tag "$TAG"');
const beginAt = source.indexOf('# dev-mock publish gate begin');
const endAt = source.indexOf('# dev-mock publish gate end');
const uploadAt = source.indexOf('BASE="$(target_path)"');

assert.ok(verifyAt >= 0 && beginAt > verifyAt && endAt > beginAt && uploadAt > endAt,
    'the gate runs after verification and before any upload target is resolved');

const block = source.slice(beginAt, endAt).split('\n').slice(1).join('\n');
const work = mkdtempSync(join(tmpdir(), 'publish-gate-'));
const harness = join(work, 'gate-harness.sh');
writeFileSync(harness, [
    '#!/usr/bin/env bash',
    'xr_header_field() {',
    '  local manifest="$1" field="$2" line prefix',
    '  prefix="# ${field}: "',
    '  while IFS= read -r line; do',
    '    if [[ "$line" == "$prefix"* ]]; then printf "%s\\n" "${line#"$prefix"}"; return 0; fi',
    '  done < "$manifest"',
    '}',
    block,
].join('\n'));

function runGate(value) {
    const manifest = join(work, `${value}.txt`);
    writeFileSync(manifest, `# dev-mock-gate: ${value}\n`);
    return spawnSync('bash', [harness], {
        encoding: 'utf8',
        env: { ...process.env, MANIFEST: manifest, TAG: 'v1.2.3' },
    });
}

const skipped = runGate('SKIPPED');
assert.equal(skipped.status, 1, 'a skipped gate is refused');
assert.match(skipped.stderr, /not 'enforced'; refusing to publish v1\.2\.3/);

const enforced = runGate('enforced');
assert.equal(enforced.status, 0, `an enforced gate continues: ${enforced.stderr}`);

process.stdout.write('OK: publish dev-mock gate smoke\n');
