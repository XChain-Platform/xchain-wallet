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

const artifactBeginAt = source.indexOf('# artifact list gate begin');
const artifactEndAt = source.indexOf('# artifact list gate end');
const pointerGateAt = source.indexOf('pointer-gate.mjs');
const phaseOneAt = source.indexOf('# --- Phase 1');
assert.ok(artifactBeginAt > endAt && artifactEndAt > artifactBeginAt,
    'the artifact gate runs after the manifest gate');
assert.ok(pointerGateAt > artifactEndAt && phaseOneAt > artifactEndAt,
    'the artifact gate runs before pointer checks and uploads');

const artifactBlock = source.slice(artifactBeginAt, artifactEndAt).split('\n').slice(1).join('\n');
const artifactHarness = join(work, 'artifact-gate-harness.sh');
writeFileSync(artifactHarness, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'xr_header_field() {',
    '  local manifest="$1" field="$2" line prefix',
    '  prefix="# ${field}: "',
    '  while IFS= read -r line; do',
    '    if [[ "$line" == "$prefix"* ]]; then printf "%s\\n" "${line#"$prefix"}"; return 0; fi',
    '  done < "$manifest"',
    '}',
    'xr_list_artifacts() {',
    '  if [[ "$XR_LIST_MODE" == fail ]]; then echo "listing failed" >&2; return 2; fi',
    '  printf "%s\\n" "$XR_LIST_CONTENT"',
    '}',
    'BINARIES=()',
    artifactBlock,
].join('\n'));

function runArtifactGate({ header, mode = 'ok', list = '' }) {
    const manifest = join(work, `artifacts-${header ?? 'missing'}-${mode}.txt`);
    writeFileSync(manifest, header === null ? '# release manifest\n' : `# artifacts: ${header}\n`);
    return spawnSync('bash', [artifactHarness], {
        encoding: 'utf8',
        env: {
            ...process.env,
            MANIFEST: manifest,
            TAG: 'v1.2.3',
            INPUT_DIR: '/staged/release',
            XR_LIST_MODE: mode,
            XR_LIST_CONTENT: list,
        },
    });
}

const listingFailed = runArtifactGate({ header: 3, mode: 'fail' });
assert.equal(listingFailed.status, 1, 'a failed artifact listing is refused');
assert.match(listingFailed.stderr, /could not list the artifacts/);

const shortListing = runArtifactGate({ header: 3, list: './one\n./two' });
assert.equal(shortListing.status, 1, 'a short artifact listing is refused');
assert.match(shortListing.stderr, /holds 2 artifact\(s\).*covers 3/);

const missingCount = runArtifactGate({ header: null, list: './one' });
assert.equal(missingCount.status, 1, 'a manifest without an artifact count is refused');

const matching = runArtifactGate({ header: 3, list: './one\n./two\n./three' });
assert.equal(matching.status, 0, `a matching artifact list continues: ${matching.stderr}`);

process.stdout.write('OK: publish manifest and artifact gates smoke\n');
