// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { validateSwapCheck } from '../../../tools/release/rehearse.mjs';
import {
    builtFromTagOf, evidenceFor, pairFromArtifacts,
} from '../../../tools/release/drills/win-update-swap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const rehearse = join(root, 'tools/release/rehearse.mjs');
const work = mkdtempSync(join(tmpdir(), 'swap-tag-binding-'));
const recordPath = join(work, 'record.json');
const resultPath = join(work, 'result.json');
const fresh = () => writeFileSync(recordPath, `${JSON.stringify({
    tag: 'v0.337.1', swaps: [], 'automated-checks': [],
}, null, 2)}\n`);
const fileResult = (result) => {
    fresh();
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    return spawnSync(process.execPath, [rehearse, 'check', '--record', recordPath,
        '--from-result', resultPath], { encoding: 'utf8' });
};

try {
    const pair = pairFromArtifacts([
        'xchain-wallet-setup-0.337.1-x64.exe',
        'xchain-wallet-setup-0.337.2-x64.exe',
        'stable.yml',
    ], 'version: 0.337.2\n');
    const evidence = evidenceFor(pair, {
        result: 'pass', runner: 'fixture native x64', silicon: 'native x64',
        builtFromTag: 'v0.337.1',
    });

    assert.equal(validateSwapCheck(evidence).ok, true);
    const filed = fileResult(evidence);
    assert.equal(filed.status, 0, filed.stderr);
    assert.equal(JSON.parse(readFileSync(recordPath, 'utf8'))['automated-checks'].length, 1);

    const failed = fileResult({ ...evidence, result: 'fail' });
    assert.equal(failed.status, 1, 'a witnessed swap failure stays release-blocking');
    assert.equal(JSON.parse(readFileSync(recordPath, 'utf8'))['automated-checks'][0].result, 'fail');

    const wrongRecord = fileResult({ ...evidence, 'built-from-tag': 'v0.337.0', from: '0.337.0' });
    assert.equal(wrongRecord.status, 1);
    assert.match(wrongRecord.stderr, /built from v0\.337\.0.*record is for v0\.337\.1/s);
    assert.deepEqual(JSON.parse(readFileSync(recordPath, 'utf8'))['automated-checks'], []);

    const wrongFrom = validateSwapCheck({ ...evidence, from: '0.337.0' });
    assert.equal(wrongFrom.ok, false);
    assert.match(wrongFrom.reason, /does not match FROM/);
    assert.equal(validateSwapCheck({ ...evidence, 'built-from-tag': 'main' }).ok, false);

    const legacy = { ...evidence };
    delete legacy['built-from-tag'];
    const oldBinding = fileResult(legacy);
    assert.equal(oldBinding.status, 1);
    assert.match(oldBinding.stderr, /check updated to 0\.337\.2/);

    assert.equal(builtFromTagOf([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.337.1' }), 'v0.337.1');
    assert.equal(builtFromTagOf([], { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' }), null);
    assert.equal(builtFromTagOf(['--tag', 'v0.337.3'], {}), 'v0.337.3');
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log('windows-swap-tag-binding.smoke.js: ok');
