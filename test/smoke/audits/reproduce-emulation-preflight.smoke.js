// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: an arm64 verifier gets told which emulator will run,
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
//  12. A non-amd64 target the host would have to emulate exits 2, never an
//      amd64 verdict; a non-amd64 target the host runs natively still passes.

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

// Invocation lines are matched, not first mentions: the extension lane names
// the preflight in its usage text long before it calls it, so a raw indexOf
// lands on prose (the same trap release-launch-probe.smoke.js documents).
const PREFLIGHT_CALL = /^\s*bash "\$\{REPO_ROOT\}\/tools\/release\/emulation-preflight\.sh"/;
// The call line is allowlisted whole rather than denylisted: the script path,
// the lane's build platform, and nothing else. Any operator after it (`||`,
// `&&`, `&`, `;`, a pipe, a redirect, a continuation) or another argument
// (`--help` exits 0 without checking anything) lets the lane carry on past
// exit 3. This is a line-shape check, not a shell parse.
const PREFLIGHT_STATEMENT =
    /^bash "\$\{REPO_ROOT\}\/tools\/release\/emulation-preflight\.sh" "\$\{BUILD_PLATFORM\}"[ \t]*$/;
const DOCKER_BUILD = /^\s*(?:\w+=\S*\s+)*docker\s+(?:buildx\s+|image\s+)?build\b/;
const ERREXIT_ON = /^set -euo pipefail$/;
const ERREXIT_OFF = /^\s*set\s+(?:\+[a-z]*e[a-z]*|\+o\s+errexit)\b/;
const OVERRIDE = /XCHAIN_REPRODUCE_ALLOW_EMULATION/;

function assertLaneGuarded(src, lane) {
    const lines = src.split('\n');
    const lineOf = (pattern) => lines.findIndex((line) => pattern.test(line));
    const callAt = lineOf(PREFLIGHT_CALL);
    assert.notEqual(callAt, -1, `${lane} does not call the preflight`);
    const buildAt = lineOf(DOCKER_BUILD);
    assert.notEqual(buildAt, -1, `${lane} has no docker build to guard`);
    assert.ok(callAt < buildAt,
        `${lane} calls the preflight AFTER docker build, which is after the failure it prevents`);
    // It has to abort the run, not decorate it: `set -e` in force at the call
    // plus an unguarded statement is what makes exit 3 stop the lane.
    const errexitAt = lineOf(ERREXIT_ON);
    assert.ok(errexitAt !== -1 && errexitAt < callAt,
        `${lane} must run under set -e for exit 3 to stop it`);
    assert.ok(!lines.slice(errexitAt + 1, callAt).some((line) => ERREXIT_OFF.test(line)),
        `${lane} turns set -e off before the preflight`);
    assert.match(lines[callAt], /^\S/,
        `${lane} runs the preflight inside a block that may not execute it`);
    assert.doesNotMatch(lines[callAt - 1] ?? '', /\\\s*$/,
        `${lane} joins the preflight onto the line above it`);
    assert.match(lines[callAt], PREFLIGHT_STATEMENT, `${lane} swallows the preflight's refusal`);
    // The override is the operator's call on a single run; a lane that sets
    // it turns the refusal off for every verifier.
    assert.doesNotMatch(src, OVERRIDE, `${lane} sets the emulation override itself`);
}

// Shapes the statement allowlist must refuse. Under `set -e`, `|| true`, `|| :`,
// `&& ...` and `&` carry the lane on past exit 3, and `|| exit 0` stops it but
// reports success. `; true` and `| cat` are inert only while `set -e` and
// `pipefail` both hold, so they are refused too rather than argued case by case.
const SWALLOW_SUFFIXES = [' || true', ' || :', ' && echo continued', ' &', '; true', ' | cat',
    ' 2>/dev/null || exit 0'];

function brokenLanes(source) {
    const lines = source.split('\n');
    const callAt = lines.findIndex((line) => PREFLIGHT_CALL.test(line));
    const buildAt = lines.findIndex((line) => DOCKER_BUILD.test(line));
    const errexitAt = lines.findIndex((line) => ERREXIT_ON.test(line));
    const call = lines[callAt];
    const swap = (at, replacement) => [...lines.slice(0, at), ...replacement, ...lines.slice(at + 1)].join('\n');
    const moved = lines.filter((_, index) => index !== callAt);
    moved.splice(buildAt, 0, call);
    return [
        ['call removed', swap(callAt, []), /does not call the preflight/],
        ['call after docker build', moved.join('\n'), /calls the preflight AFTER docker build/],
        ['buildx before call', swap(callAt, ['docker buildx build .', call]), /AFTER docker build/],
        ...SWALLOW_SUFFIXES.map((suffix) => [`suffix ${suffix.trim()}`, swap(callAt, [call + suffix]),
            /swallows the preflight's refusal/]),
        ['continued onto || true', swap(callAt, [`${call} \\`, '    || true']), /swallows the preflight's refusal/],
        ['inside an if block', swap(callAt, ['if [ -n "${CI:-}" ]; then', `    ${call}`, 'fi']),
            /inside a block that may not execute it/],
        ['set +e before call', swap(callAt, ['set +e', call]), /turns set -e off before the preflight/],
        ['set +euo before call', swap(callAt, ['set +euo pipefail', call]), /turns set -e off before the preflight/],
        ['no set -e', swap(errexitAt, ['set -uo pipefail']), /must run under set -e/],
        ['joined onto true ||', swap(callAt, ['true || \\', call]), /joins the preflight onto the line above it/],
        ['--help argument', swap(callAt, [call.replace('"${BUILD_PLATFORM}"', '--help')]),
            /swallows the preflight's refusal/],
        ['override exported', swap(callAt, ['export XCHAIN_REPRODUCE_ALLOW_EMULATION=1', call]),
            /sets the emulation override itself/],
    ];
}

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
    // The interpreter path is inert here (the preflight matches on the handler
    // NAME), so this carries the path a Rosetta-for-Linux guest really shows.
    const binfmt = fakeBinfmt([{ name: 'RosettaLinux', interpreter: '/run/rosetta/rosetta' }]);
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
        assertLaneGuarded(readFileSync(join(wsRoot, lane), 'utf8'), lane);
    }
});

check('10a. the lane-order check fails on broken invocation wiring', () => {
    for (const lane of LANES) {
        const source = readFileSync(join(wsRoot, lane), 'utf8');
        assert.doesNotThrow(() => assertLaneGuarded(source, lane));
        for (const [label, broken, refusal] of brokenLanes(source)) {
            assert.throws(() => assertLaneGuarded(broken, `${lane} (${label})`), refusal, `${lane}: ${label} passed`);
        }
    }
});

check('10b. an unknown option exits 2, and both the header and --help document every exit code', () => {
    const bad = spawnSync('bash', [PREFLIGHT, '--bogus'], { encoding: 'utf8' });
    assert.equal(bad.status, 2, `${bad.stdout}${bad.stderr}`);
    const help = spawnSync('bash', [PREFLIGHT, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    for (const code of ['0', '2', '3']) {
        assert.match(help.stdout, new RegExp(`^\\s+${code}\\s+\\w+:`, 'm'), `--help omits exit ${code}`);
    }
    const header = readFileSync(PREFLIGHT, 'utf8').split('\n').find((l) => /^# Exit 0 /.test(l)) ?? '';
    assert.match(header, /exit 2 usage/, `the header exit line omits exit 2: ${header}`);
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

check('12. a non-amd64 target that needs emulation is a usage error, not an amd64 verdict', () => {
    const cases = [
        // qemu for the asked arch is registered; the amd64 table would say none is.
        { arch: 'x86_64', platform: 'linux/arm64', binfmt: fakeBinfmt([{ name: 'qemu-aarch64' }]) },
        // Rosetta translates x86_64 only, so it must not read as a route to riscv64.
        { arch: 'aarch64', platform: 'linux/riscv64', binfmt: fakeBinfmt([{ name: 'RosettaLinux' }]) },
        // Neither the override nor the macOS advisory may answer for a target they do not cover.
        { arch: 'x86_64', platform: 'linux/arm64', binfmt: fakeBinfmt(), allow: '1' },
        { arch: 'x86_64', os: 'Darwin', platform: 'linux/arm64', binfmt: fakeBinfmt() },
    ];
    for (const c of cases) {
        const { code, out } = run(c);
        assert.equal(code, 2, `${c.arch} asked for ${c.platform}: ${out}`);
        assert.match(out, /only knows which emulators finish a linux\/amd64 build/);
        assert.doesNotMatch(out, /REFUSING TO START|no amd64 emulation is registered|speed penalty/);
    }
    const native = run({ arch: 'aarch64', platform: 'linux/arm64', binfmt: fakeBinfmt() });
    assert.equal(native.code, 0, native.out);
    assert.match(native.out, /natively/);
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
