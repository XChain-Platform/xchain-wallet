// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : an arm64 verifier gets told which emulator will run,
// BEFORE the build, instead of a Go traceback twenty minutes in.
//
// WHAT THIS IS DEFENDING. All three reproduce lanes pin an amd64-only base
// image and pass `--platform linux/amd64`. That flag says which platform to
// run; it says nothing about whether the host can run it, and the two
// emulators that answer it behave differently on exactly the binary this
// build leans on hardest:
//
//   Rosetta     runs esbuild's static Go binary correctly. Measured
//               2026-08-04 on an aarch64 Ubuntu VM with Rosetta for Linux:
//               the extension bundle came out byte-identical to a native
//               amd64 host's, 45/45.
//   qemu-user   crashes inside Go's runtime. The extension lane reports
//               `[vite:define] The service was stopped`; the desktop lane
//               reports `fatal error: lfstack.push`. Neither names qemu,
//               neither names the architecture, and both read as a defect
//               in the wallet - which is an hour of somebody's life, twice
//               measured, and a verifier's most likely conclusion is that
//               our published hashes cannot be trusted.
//
// So the preflight is a decision table over host arch, host OS and the
// registered binfmt handlers, and this drives every branch of it against
// FAKE binfmt directories: no emulator, no container, no network. The
// wiring half then holds each lane to calling it BEFORE its first
// `docker build`, since a preflight that runs after the twenty minutes it
// was meant to save is decoration.
//
// Coverage:
//
//   1. Native amd64 host: proceeds, and says so.
//   2. arm64 + an enabled Rosetta handler: proceeds, names Rosetta.
//   3. arm64 + only qemu: REFUSES (exit 3), names the Go-runtime crash and
//      the routes that work.
//   4. arm64 + a DISABLED qemu handler: refuses. A stale registration is
//      not a working route.
//   5. arm64 + both handlers: proceeds with a warning, because binfmt_misc
//      does not expose which one the kernel would pick.
//   6. arm64 + no handler at all, and arm64 + no binfmt_misc: refuse.
//   7. `register` and `status` are control files, not handlers.
//   8. macOS arm64: advisory, never a refusal - Docker Desktop with
//      Rosetta is a supported route and its emulator is not readable here.
//   9. The documented override proceeds, loudly.
//  10. All three reproduce lanes call it, ahead of their first docker build.
//  11. The published doc names the qemu limitation and the working routes,
//      and no longer carries the retracted claim that emulation just works.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsAvailable, readDoc } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const PREFLIGHT = join(wsRoot, 'tools', 'release', 'emulation-preflight.sh');

const LANES = [
    join('packages', 'desktop', 'scripts', 'reproduce.sh'),
    join('packages', 'extension', 'scripts', 'reproduce.sh'),
    join('packages', 'web', 'scripts', 'reproduce.sh'),
];

const checks = [];
function check(name, fn) { checks.push([name, fn]); }

// A binfmt_misc entry, in the kernel's own shape: state on line 1, then the
// interpreter and the ELF magic. The preflight reads line 1 and the name, so
// both have to be real for the test to mean anything.
function handler(dir, name, { enabled = true, interpreter = '/usr/bin/x' } = {}) {
    writeFileSync(join(dir, name), [
        enabled ? 'enabled' : 'disabled',
        `interpreter ${interpreter}`,
        'flags: OCF',
        'offset 0',
        'magic 7f454c4602010100000000000000000002003e00',
        '',
    ].join('\n'));
}

const scratchDirs = [];

function fakeBinfmt(entries = []) {
    const dir = mkdtempSync(join(tmpdir(), 'xc1101-binfmt-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'status'), 'enabled\n');
    writeFileSync(join(dir, 'register'), '');
    for (const e of entries) handler(dir, e.name, e);
    return dir;
}

function run({ arch = 'aarch64', os = 'Linux', binfmt, allow, platform = 'linux/amd64' } = {}) {
    const env = { ...process.env, XCHAIN_HOST_ARCH: arch, XCHAIN_HOST_OS: os };
    if (binfmt !== undefined) env.XCHAIN_BINFMT_DIR = binfmt;
    if (allow !== undefined) env.XCHAIN_REPRODUCE_ALLOW_EMULATION = allow;
    else delete env.XCHAIN_REPRODUCE_ALLOW_EMULATION;
    const r = spawnSync('bash', [PREFLIGHT, platform], { env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

check('1. a native amd64 host proceeds without mentioning emulation', () => {
    for (const arch of ['x86_64', 'amd64']) {
        const { code, out } = run({ arch, binfmt: fakeBinfmt() });
        assert.equal(code, 0, `${arch} should proceed`);
        assert.match(out, /natively/);
        assert.doesNotMatch(out, /EMULATE/);
    }
    // The spellings have to normalize on BOTH sides, or an arm64 host asking
    // for linux/arm64 reads as a cross-arch build of itself.
    const { code, out } = run({ arch: 'aarch64', platform: 'linux/arm64', binfmt: fakeBinfmt() });
    assert.equal(code, 0);
    assert.match(out, /natively/);
});

check('2. arm64 with Rosetta registered proceeds and names it', () => {
    const binfmt = fakeBinfmt([{ name: 'RosettaLinux', interpreter: 'REDACTED-LOCAL-PATH' }]);
    const { code, out } = run({ binfmt });
    assert.equal(code, 0, out);
    assert.match(out, /RosettaLinux/);
    assert.match(out, /speed penalty, not a crash/);
});

check('3. arm64 with only qemu refuses, and says what breaks and what works', () => {
    const binfmt = fakeBinfmt([{ name: 'qemu-x86_64', interpreter: '/usr/bin/qemu-x86_64-static' }]);
    const { code, out } = run({ binfmt });
    assert.equal(code, 3, `expected refusal, got ${code}: ${out}`);
    assert.match(out, /REFUSING TO START/);
    assert.match(out, /qemu-x86_64/);
    assert.match(out, /esbuild's Go runtime/);
    // A refusal that does not hand over a working route is just a wall.
    assert.match(out, /amd64 Linux host/);
    assert.match(out, /Docker Desktop on Apple Silicon/);
    assert.match(out, /Rosetta for Linux/);
    assert.match(out, /XCHAIN_REPRODUCE_ALLOW_EMULATION=1/);
});

check('4. a DISABLED handler is not a working route', () => {
    const binfmt = fakeBinfmt([
        { name: 'qemu-x86_64', enabled: false },
        { name: 'RosettaLinux', enabled: false },
    ]);
    const { code, out } = run({ binfmt });
    assert.equal(code, 3, out);
    assert.match(out, /no amd64 emulation is registered/);
});

check('5. both registered: proceed, but say the choice is not readable', () => {
    const binfmt = fakeBinfmt([{ name: 'RosettaLinux' }, { name: 'qemu-x86_64' }]);
    const { code, out } = run({ binfmt });
    assert.equal(code, 0, out);
    assert.match(out, /both RosettaLinux and qemu-x86_64 are registered/);
    assert.match(out, /registration order/);
    // and hand over the way out of the ambiguity
    assert.match(out, /echo -1 >/);
});

check('6. no handler, and no binfmt_misc at all, both refuse', () => {
    const empty = run({ binfmt: fakeBinfmt() });
    assert.equal(empty.code, 3, empty.out);
    assert.match(empty.out, /exec-format error/);

    const missing = run({ binfmt: join(tmpdir(), 'xc1101-does-not-exist') });
    assert.equal(missing.code, 3, missing.out);
    assert.match(missing.out, /no way to tell what would execute/);
});

check('7. register/status are control files, not amd64 emulators', () => {
    // A bare binfmt_misc always holds these two. Reading either as a handler
    // would turn "nothing is registered" into a false green.
    const { code, out } = run({ binfmt: fakeBinfmt() });
    assert.equal(code, 3);
    assert.doesNotMatch(out, /\bstatus\b|\bregister\b/);
});

check('8. macOS advises rather than refuses', () => {
    const { code, out } = run({ arch: 'arm64', os: 'Darwin', binfmt: join(tmpdir(), 'nope') });
    assert.equal(code, 0, out);
    assert.match(out, /Use Rosetta for x86_64\/amd64 emulation/);
    assert.doesNotMatch(out, /REFUSING/);
});

check('9. the override proceeds, and warns what it is overriding', () => {
    const binfmt = fakeBinfmt([{ name: 'qemu-x86_64' }]);
    const { code, out } = run({ binfmt, allow: '1' });
    assert.equal(code, 0, out);
    assert.match(out, /Go traceback/);
});

check('10. every reproduce lane runs the preflight before its first docker build', () => {
    for (const lane of LANES) {
        const src = readFileSync(join(wsRoot, lane), 'utf8');
        const callIdx = src.indexOf('tools/release/emulation-preflight.sh');
        assert.notEqual(callIdx, -1, `${lane} does not call the preflight`);
        const buildIdx = src.indexOf('docker build');
        assert.notEqual(buildIdx, -1, `${lane} has no docker build to guard`);
        assert.ok(
            callIdx < buildIdx,
            `${lane} calls the preflight AFTER docker build, which is after the failure it prevents`,
        );
        // It has to abort the run, not decorate it: `set -e` plus an
        // unguarded call is what makes exit 3 stop the lane.
        assert.match(src, /^set -euo pipefail$/m, `${lane} must run under set -e for exit 3 to stop it`);
        assert.doesNotMatch(
            src.slice(callIdx, callIdx + 200),
            /\|\||true\s*$/m,
            `${lane} swallows the preflight's refusal`,
        );
    }
});

check('11. the published doc names the trap and the routes that work', () => {
    if (!docsAvailable('reproduce-emulation-preflight')) return;
    const doc = readDoc('reproducible-builds.md');

    // The retracted claim. It was measured on a lane that does not push
    // esbuild through qemu the same way, and it is why the desktop set was
    // attempted on qemu at all.
    assert.doesNotMatch(
        doc,
        /this has been exercised and works, at a speed penalty/,
        'the doc still carries the retracted "emulation just works" claim',
    );

    for (const phrase of [
        'qemu',
        'Rosetta',
        'emulation-preflight.sh',
        'lfstack.push',
        'The service was stopped',
    ]) {
        assert.ok(doc.includes(phrase), `reproducible-builds.md never mentions ${phrase}`);
    }

    // The desktop section is the one that carried the false claim, so pin
    // the correction to that section rather than to the file as a whole.
    const desktop = doc.slice(doc.indexOf('## Desktop'), doc.indexOf('## Extension'));
    assert.ok(desktop.length > 0, 'no desktop section found');
    assert.ok(
        /qemu/i.test(desktop),
        'the desktop section does not state the qemu limitation that killed its own lane',
    );
});

let failed = 0;
for (const [name, fn] of checks) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL ${name}`);
        console.error(`       ${err.message}`);
    }
}

// Fake binfmt dirs live under the OS temp dir; clean the ones we made.
for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });

if (failed) {
    console.error(`reproduce-emulation-preflight: ${failed} check(s) failed`);
    process.exit(1);
}
console.log('reproduce-emulation-preflight: all checks passed');
