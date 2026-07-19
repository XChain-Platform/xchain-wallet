// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the T-RSL redistribution gate .
//
// tools/build-reproduce/check-no-trezor-dist.sh is a CI build-verify step that
// greps the three shipped shells' built dist/ for a bundled `@trezor` scope
// token and fails on a hit, guarding the c541ac7 hosted-script migration. This
// smoke exercises the guard's DETECTION and CLEAN-PASS logic directly, against
// synthetic dist fixtures, so it runs in the smoke gate (which has no real
// build) rather than only in the post-build CI job.
//
// It verifies:
//   1. A clean dist tree passes (exit 0).
//   2. A tree with an `@trezor` scope token in an executable file fails.
//   3. The token is caught inside an HTML file too (the desktop index.html
//      regression class this gate was written for).
//   4. `*.map` sourcemaps are ignored (the trezorFactory.js JSDoc comments that
//      reference `@trezor/connect-web` survive only in maps and must not trip it).
//   5. A missing dist dir is a hard failure, not a silent skip.

import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const script = join(wsRoot, 'tools', 'build-reproduce', 'check-no-trezor-dist.sh');

// Run the gate against explicit dist dirs and return { code, out }.
function runGate(...dirs) {
    const r = spawnSync('bash', [script, ...dirs], { encoding: 'utf8' });
    if (r.error) throw r.error;
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Build a fresh fixture dir with the given files ({ relpath: contents }).
function fixture(files) {
    const root = mkdtempSync(join(tmpdir(), 'xc219-'));
    for (const [rel, contents] of Object.entries(files)) {
        const full = join(root, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents);
    }
    return root;
}

const made = [];
const dist = (files) => {
    const d = fixture(files);
    made.push(d);
    return d;
};

try {
    // 1. Clean tree passes. "connect.trezor.io" / "Trezor" prose is fine; only
    //    the `@trezor` scope token trips the gate, and none is present.
    const clean = dist({
        'assets/index-abc.js': 'const url="https://connect.trezor.io/9/trezor-connect.js";',
        'index.html': '<!-- script-src https://connect.trezor.io; loads Trezor Connect -->',
    });
    let r = runGate(clean);
    assert.equal(r.code, 0, `clean tree should pass, got:\n${r.out}`);

    // 2. `@trezor` token in an executable asset fails.
    const dirtyJs = dist({
        'assets/index-abc.js': 'import x from "@trezor/connect-web";',
    });
    r = runGate(dirtyJs);
    assert.notEqual(r.code, 0, 'bundled @trezor import in JS must fail the gate');
    assert.match(r.out, /@trezor/, 'failure output names the offending token');

    // 3. `@trezor` token in an HTML file fails (the desktop index.html class).
    const dirtyHtml = dist({
        'index.html': '<!-- keeps zero `@trezor/*` code in the packaged app -->',
    });
    r = runGate(dirtyHtml);
    assert.notEqual(r.code, 0, '@trezor token in HTML must fail the gate');

    // 4. A `.map` carrying the token is ignored (sourcemaps are excluded).
    const onlyMap = dist({
        'assets/index-abc.js': 'const ok=1;',
        'assets/index-abc.js.map': '{"sources":["trezorFactory.js"],"x":"@trezor/connect-web"}',
    });
    r = runGate(onlyMap);
    assert.equal(r.code, 0, `@trezor only in a .map must be ignored, got:\n${r.out}`);

    // 5. A missing dist dir is a hard failure (no silent false-green skip).
    r = runGate(join(tmpdir(), 'xc219-does-not-exist-xyz'));
    assert.notEqual(r.code, 0, 'a missing dist dir must fail the gate');
    assert.match(r.out, /not built/, 'missing-dir failure explains why');

    // 6. Multiple dirs: one dirty among clean ones still fails.
    r = runGate(clean, dirtyJs);
    assert.notEqual(r.code, 0, 'any dirty dir fails even alongside clean ones');
} finally {
    for (const d of made) rmSync(d, { recursive: true, force: true });
}

console.log('dist-no-trezor smoke OK');
