// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §52 / G004 — `tools/regtest/` scaffolding.
//
// The actual stack lives upstream in `xchain-node`; the scripts here
// are the wallet's thin glue. This smoke pins the directory + script
// existence + executable bits + structural shape, plus exercises the
// bootstrap.sh failure path against an unreachable base URL so the
// canonical "stack not running" error surface stays stable.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Directory + scripts exist with the expected shape.
const files = [
    'tools/regtest/README.md',
    'tools/regtest/bootstrap.sh',
    'tools/regtest/wait-ready.sh',
    'tools/regtest/down.sh',
];
for (const p of files) {
    assert.ok(existsSync(join(root, p)), `${p} exists`);
}
for (const p of ['tools/regtest/bootstrap.sh', 'tools/regtest/wait-ready.sh', 'tools/regtest/down.sh']) {
    const st = statSync(join(root, p));
    assert.ok((st.mode & 0o111) !== 0,
        `${p} has the executable bit set`);
}

// 2. README structural headings + canonical env vars + spec citations.
const readme = read('tools/regtest/README.md');
for (const heading of [
    '# Regtest integration',
    '## Why this exists',
    '## Path forward',
    '## Inputs',
    '## Scripts',
    '## Environment variables',
    '## Per-test-suite procedure',
    '## Status today',
]) {
    assert.ok(readme.includes(heading),
        `README has heading: ${heading}`);
}
for (const envVar of ['XCHAIN_REGTEST_BASE_URL', 'XCHAIN_REGTEST_TIMEOUT_MS', 'XCHAIN_REGTEST_VERBOSE']) {
    assert.ok(readme.includes(envVar),
        `README documents ${envVar}`);
}
assert.ok(/§52/.test(readme), 'README cites §52');
assert.ok(/G163/.test(readme), 'README cites the paired G163 row');
assert.ok(/xchain-node/.test(readme), 'README points at the upstream xchain-node orchestrator');

// 3. Each script's shape — bash shebang, set -euo pipefail, env-var docs.
const bootstrap = read('tools/regtest/bootstrap.sh');
assert.ok(/^#!\/usr\/bin\/env bash/.test(bootstrap), 'bootstrap.sh has bash shebang');
assert.ok(/set -euo pipefail/.test(bootstrap), 'bootstrap.sh has strict-mode guard');
assert.ok(/XCHAIN_REGTEST_BASE_URL/.test(bootstrap),
    'bootstrap.sh reads the canonical base-URL env var');
// All seven services from the README's Inputs table appear in the
// SERVICES array — keeping these in lockstep matters because the
// wallet's tests depend on every one being up.
for (const svc of [
    'bitcoin-regtest', 'dogecoin-regtest', 'litecoin-regtest',
    'xchain-decoder', 'xchain-indexer', 'xchain-explorer', 'xchain-hub',
]) {
    assert.ok(bootstrap.includes(svc),
        `bootstrap.sh probes ${svc}`);
}
assert.ok(/xchain-node\.sh start/.test(bootstrap),
    'bootstrap.sh diagnostic points at the upstream start command');

const wait = read('tools/regtest/wait-ready.sh');
assert.ok(/^#!\/usr\/bin\/env bash/.test(wait));
assert.ok(/set -euo pipefail/.test(wait));
assert.ok(/XCHAIN_REGTEST_TIMEOUT_MS/.test(wait),
    'wait-ready.sh honours the timeout env var');
assert.ok(/bootstrap\.sh/.test(wait),
    'wait-ready.sh delegates the per-attempt check to bootstrap.sh');

const down = read('tools/regtest/down.sh');
assert.ok(/^#!\/usr\/bin\/env bash/.test(down));
assert.ok(/set -euo pipefail/.test(down));
assert.ok(/xchain-node\.sh.*stop/.test(down),
    'down.sh delegates to the upstream xchain-node stop command');
assert.ok(/XCHAIN_PLATFORM_DIR/.test(down),
    'down.sh honours the platform-dir override env var');

// 4. Runtime — bootstrap.sh against a deliberately unreachable base
//    URL exits 1 with the documented diagnostic. Picked an
//    RFC-5737-reserved IP so we never accidentally hit a real host.
const probe = spawnSync('bash', [join(root, 'tools/regtest/bootstrap.sh')], {
    encoding: 'utf8',
    env: {
        ...process.env,
        XCHAIN_REGTEST_BASE_URL: 'http://192.0.2.1',  // TEST-NET-1, guaranteed unroutable
    },
    timeout: 90_000,
});
assert.equal(probe.status, 1,
    `bootstrap.sh against TEST-NET-1 exits 1 (got ${probe.status})`);
assert.ok(/service\(s\) not responding/.test(probe.stderr),
    'bootstrap.sh diagnostic mentions the count of failing services');
assert.ok(/xchain-node\.sh start/.test(probe.stderr),
    'bootstrap.sh diagnostic surfaces the start command');

// 5. wait-ready.sh with a tiny timeout against an unreachable base
//    URL should fail with the timeout diagnostic.
const wr = spawnSync('bash', [join(root, 'tools/regtest/wait-ready.sh')], {
    encoding: 'utf8',
    env: {
        ...process.env,
        XCHAIN_REGTEST_BASE_URL: 'http://192.0.2.1',
        XCHAIN_REGTEST_TIMEOUT_MS: '1000',
    },
    timeout: 90_000,
});
assert.equal(wr.status, 1,
    `wait-ready.sh against TEST-NET-1 with 1s timeout exits 1 (got ${wr.status})`);
assert.ok(/stack not ready after/.test(wr.stderr),
    'wait-ready.sh diagnostic mentions the timeout');

// 6. test/e2e/README.md still references the regtest stack location
//    so a developer following the docs reaches these scripts.
const e2eReadme = read('test/e2e/README.md');
assert.ok(/regtest/i.test(e2eReadme),
    'test/e2e/README mentions regtest (so devs know where to look)');

console.log('OK — tools/regtest/ scaffolding smoke');
