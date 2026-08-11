// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for `sign.sh --passphrase-file`, the operator ruling recorded as
// `dq-9` (2026-08-10): a STAGING rehearsal may read K1's passphrase from a
// file so a run can drive itself end to end, and a PRODUCTION signature keeps
// a human at the pinentry.
//
// The ruling is an ASYMMETRY, and an asymmetry is the shape of rule that
// decays quietly. Both halves fail silently in opposite directions: a
// rehearsal that cannot read a passphrase blocks forever on a pinentry nobody
// is sitting at, which reads as a hang; a production run that CAN read one
// signs perfectly and stops being a ceremony, which reads as a success. So
// each of the four behaviours below is driven rather than asserted from the
// source text.
//
// WHAT IS PINNED:
//   1. --passphrase-file on a production run (no --staging) is REFUSED,
//      exit 2, and the message states the ruling rather than a syntax error.
//   2. --staging with an unreadable passphrase file is refused, exit 2.
//   3. --staging with a passphrase file readable by group or other is
//      refused, exit 2, NAMING the mode.
//   3b. --staging whose mode cannot be READ at all is refused too, exit 2,
//      rather than skipping the check. Driven with a `stat` stub that
//      reproduces the garbled read the old BSD-first order produced on Linux.
//   4. The gpg invocation itself, in BOTH directions: the loopback pair is
//      prepended when a rehearsal supplies a file, and the argument list is
//      otherwise the one it always was.
//
// NO PASSPHRASE, REAL OR OTHERWISE, IS EVER HANDLED HERE. The fixture file
// holds an obviously-fake string this smoke writes itself, and nothing reads
// it back: what a case asserts on is the PATH sign.sh passed and the mode it
// refused, never a byte of content. The release store under the operator's
// home directory is not touched, read, or stat'd by any line of this file,
// and the stub gpg below deliberately does not open the file it is handed.
//
// CASE 4 SIGNS NOTHING, and that is what makes it checkable at all. A stub
// `gpg` earlier in PATH records the argv sign.sh built and exits 0, which is
// the same trick release-payload-arch.smoke.js uses to decide what the
// extractors on a host do. Recording the argv rather than grepping sign.sh
// for the flag names is the point: `${GPG_PASSPHRASE_ARGS[@]+"..."}` is a
// `set -u` idiom whose failure modes (an empty positional argument on the
// no-file path, or the pair landing in the wrong place) are invisible in the
// source and obvious in an argv.
//
// THE FIXTURE IS A WINDOWS REHEARSAL SET, which is the cheapest complete one.
// `--staging --os windows` gates against `*.exe` at both arches and nothing
// else, so two synthetic PE files with a populated certificate table satisfy
// the artifact-set gate and the signature gate, and the Linux payload gates
// (which want real Debian archives) never fire. Case 4 needs sign.sh to reach
// its last line, so the set has to be genuinely complete for the run it
// declares; it does not have to be a whole release.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
    chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const TAG = 'v9.9.9';
const VERSION = '9.9.9';
// A placeholder key name, exactly as release-tools.smoke.js uses one: the
// stub gpg below never looks at it, and every gate under test runs ahead of
// any real key material.
const KEY = 'smoke-placeholder-not-a-key';
// The whole of the "passphrase" this file ever handles. It is not a
// passphrase, it is a marker that would be laughable in a keystore, and no
// assertion reads it back out.
const FAKE_PASSPHRASE = 'THIS-IS-NOT-A-PASSPHRASE-smoke-fixture\n';

const work = mkdtempSync(join(tmpdir(), 'xc-dq9-'));
let failures = 0;
const check = (label, cond, detail) => {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
};

const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

/**
 * A minimal PE32+ with a populated certificate table, so the signature gate
 * reads it as an Authenticode-signed installer. Same construction as
 * release-signature-gate.smoke.js and release-tools.smoke.js: assembled here
 * rather than committed, because what has to be true is that the gate reads
 * THAT field.
 */
function signedPe() {
    const b = Buffer.alloc(0x400);
    b.writeUInt16LE(0x5a4d, 0);                  // MZ
    b.writeUInt32LE(0x80, 0x3c);                 // e_lfanew
    b.writeUInt32LE(0x00004550, 0x80);           // PE\0\0
    const opt = 0x80 + 24;
    b.writeUInt16LE(0x20b, opt);                 // PE32+
    b.writeUInt32LE(16, opt + 108);              // NumberOfRvaAndSizes
    b.writeUInt32LE(0x9000, opt + 112 + 32);     // certificate table RVA
    b.writeUInt32LE(2048, opt + 112 + 36);       // and its size
    return b;
}

try {
    // --- the throwaway clone sign.sh is willing to sign from -------------
    //
    // The pristine-clone gate wants a tag that exists, HEAD sitting on it and
    // a clean worktree, so the fixture is a real (tiny) git repo. Only the
    // files sign.sh actually reads ride along: lib.sh because it is sourced,
    // update-info.mjs because lib.sh asks it which files are channel
    // pointers, verify-signatures.mjs because sign.sh runs it unconditionally
    // before writing a manifest, and the two declaration files the gates read.
    const repo = join(work, 'repo');
    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    for (const f of ['lib.sh', 'sign.sh', 'expected-artifacts.txt', 'shipped-lanes.txt',
        'update-info.mjs', 'verify-signatures.mjs', 'store-profile-status.txt']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }
    git(repo, ['init', '-q', '.']);
    git(repo, ['add', '-A']);
    // An identity and both gpgsign settings pinned off, for the reason
    // release-tools.smoke.js records: the release-rails work turned tag and
    // commit signing on globally on the box that does real releases, and this
    // throwaway repo must not inherit it. What is under test is sign.sh, never
    // the fixture's own git objects.
    const gitId = ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
        '-c', 'commit.gpgsign=false'];
    git(repo, [...gitId, 'commit', '-qm', 'init']);
    git(repo, ['-c', 'tag.gpgsign=false', 'tag', TAG]);
    assert.match(git(repo, ['rev-parse', TAG]).stdout.trim(), /^[0-9a-f]{40}$/,
        'throwaway repo has a tagged commit');

    const SIGN = join(repo, 'tools/release/sign.sh');

    /** A fresh, complete Windows rehearsal set. Fresh per run: sign.sh
     *  refuses to overwrite a manifest, and reusing one dir would make the
     *  second signing run fail for a reason that is not the one under test. */
    const stage = () => {
        const dir = mkdtempSync(join(work, 'stage-'));
        for (const arch of ['x64', 'arm64']) {
            writeFileSync(join(dir, `xchain-wallet-setup-${VERSION}-${arch}.exe`), signedPe());
        }
        return dir;
    };

    // --- the stub gpg ----------------------------------------------------
    //
    // Records the argument list and signs nothing. It writes one argument per
    // line and truncates first, so an EMPTY argument (the failure mode the
    // `${arr[@]+"${arr[@]}"}` idiom exists to avoid) survives into the log as
    // an empty line rather than vanishing.
    //
    // It never opens the file named by --passphrase-file. Case 4 is about
    // which arguments sign.sh constructs; reading the fixture would add
    // nothing and would put a "passphrase" through a second pair of hands.
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const gpgStub = join(bin, 'gpg');
    writeFileSync(gpgStub,
        '#!/bin/sh\n'
        + '# Stub: records argv for release-passphrase-source.smoke.js, signs nothing.\n'
        + ': > "$XCHAIN_SMOKE_GPG_ARGV"\n'
        + 'for a in "$@"; do printf \'%s\\n\' "$a" >> "$XCHAIN_SMOKE_GPG_ARGV"; done\n'
        + 'exit 0\n');
    chmodSync(gpgStub, 0o755);

    // --- the stub stat ---------------------------------------------------
    //
    // Lives in its OWN directory, so only the one case that asks for it is
    // ever run under it: every other case has to read a real mode or it is
    // testing nothing.
    //
    // It reproduces, exactly, what the mode read produced on a Linux host
    // before the GNU-first order landed. `stat -f` is `--file-system` on GNU,
    // so the BSD form printed a filesystem status block to stdout and the
    // fallback appended the real mode after it. The stub prints that same
    // six-line block plus a trailing mode and exits 0, which is the shape the
    // fail-closed branch exists for: a value that is neither empty nor a mode.
    // It ignores its arguments, because what the caller asked for is not what
    // a garbled read answers.
    const statBin = join(work, 'bin-stat');
    mkdirSync(statBin, { recursive: true });
    const statStubPath = join(statBin, 'stat');
    writeFileSync(statStubPath,
        '#!/bin/sh\n'
        + '# Stub: reproduces the Linux `stat -f` filesystem dump for\n'
        + '# release-passphrase-source.smoke.js. Ignores argv, exits 0.\n'
        + 'cat <<\'EOF\'\n'
        + '  File: "/dev/null"\n'
        + '    ID: 0        Namelen: 255     Type: tmpfs\n'
        + 'Block size: 4096       Fundamental block size: 4096\n'
        + 'Blocks: Total: 1024000    Free: 1023000    Available: 1023000\n'
        + 'Inodes: Total: 4096000    Free: 4095000\n'
        + '644\n'
        + 'EOF\n'
        + 'exit 0\n');
    chmodSync(statStubPath, 0o755);

    /**
     * Run sign.sh. `argvLog`, when given, puts the stub gpg ahead of any real
     * one on PATH and points it at that file; `statStub` does the same for the
     * stub stat, and is off unless a case asks for it.
     */
    const run = (args, { argvLog, statStub } = {}) => {
        const env = {
            ...process.env,
            XCHAIN_RELEASE_GPG_KEY: KEY,
            // The dev-mock gate is a different gate with its own driver, and
            // it cannot pass over a two-file fixture (it refuses a scan that
            // covered nothing, correctly). Skipping it records SKIPPED in the
            // manifest header and changes nothing about the gpg call, which is
            // the only thing case 4 reads.
            SIGN_SKIP_DEV_MOCK_CHECK: '1',
        };
        delete env.XCHAIN_RELEASE_TAG;
        delete env.XCHAIN_RELEASE_DIR;
        delete env.XCHAIN_RELEASE_REPO;
        delete env.XCHAIN_RELEASE_LANES;
        // The stub stat goes ahead of the stub gpg, which is only an ordering
        // between two directories that share no names; both go ahead of the
        // real PATH.
        const stubDirs = [];
        if (statStub) stubDirs.push(statBin);
        if (argvLog) {
            env.XCHAIN_SMOKE_GPG_ARGV = argvLog;
            stubDirs.push(bin);
        }
        if (stubDirs.length > 0) env.PATH = `${stubDirs.join(':')}:${process.env.PATH}`;
        return spawnSync('bash', [SIGN, '--tag', TAG, '--repo', repo, ...args],
            { encoding: 'utf8', env });
    };

    /** The passphrase fixture, at whatever mode a case wants to test. */
    const passphraseFile = (name, mode) => {
        const p = join(work, name);
        writeFileSync(p, FAKE_PASSPHRASE, { mode: 0o600 });
        chmodSync(p, mode);
        return p;
    };

    // EVERY REFUSAL CASE BELOW RUNS UNDER THE STUB GPG TOO, and that is not
    // decoration. Measured against a control sign.sh with all three guards
    // disabled: cases 2 and 3 fell through to a REAL gpg, which refused the
    // placeholder key with exit 2 of its own, so `status === 2` passed on a
    // build that had stopped refusing anything. With the stub in place a
    // fall-through signs and exits 0, and the absence of the argv log is then
    // a positive statement that gpg was never reached at all.
    const neverSigned = (label, log) =>
        check(`${label}: gpg was never reached`, !existsSync(log),
            'the run got as far as invoking gpg, so it was not refused');

    // --- 1. Production plus --passphrase-file is refused ------------------
    //
    // The half of the ruling that can fail successfully. Exit 2 alone would
    // also be produced by "unknown argument", by a missing --tag, and by the
    // --os guard six lines above it, so the message is asserted too: what has
    // to be true is that this run was refused BECAUSE it was production, and a
    // run refused for the wrong reason still exits 2.
    {
        const pf = passphraseFile('prod-refusal.pass', 0o600);
        const log = join(work, 'argv-prod.txt');
        const r = run(['--input', stage(), '--passphrase-file', pf], { argvLog: log });
        check('a production run with --passphrase-file exits 2',
            r.status === 2, `exit ${r.status}: ${r.stderr}`);
        check('and is refused for being production, not for bad syntax',
            /--passphrase-file is only allowed with --staging/.test(r.stderr), r.stderr);
        check('and states the ruling rather than only the rule',
            /dq-9/.test(r.stderr) && /pinentry/.test(r.stderr), r.stderr);
        neverSigned('production + --passphrase-file', log);
    }

    // --- 2. A staging run whose passphrase file cannot be read ------------
    //
    // A path that does not exist, rather than a mode-000 file: a suite that
    // runs as root reads a 000 file perfectly and would then fall through to
    // the mode check, where `000` ends in `00` and PASSES. The case would go
    // green on the venue while testing nothing.
    {
        const missing = join(work, 'no-such-passphrase-file');
        check('fixture: the unreadable path really is absent', !existsSync(missing));
        const log = join(work, 'argv-unreadable.txt');
        const r = run(['--input', stage(), '--staging', '--os', 'windows',
            '--passphrase-file', missing], { argvLog: log });
        check('a staging run with an unreadable passphrase file exits 2',
            r.status === 2, `exit ${r.status}: ${r.stderr}`);
        check('and says the file is not readable, naming it',
            /is not readable/.test(r.stderr) && r.stderr.includes(missing), r.stderr);
        neverSigned('staging + unreadable passphrase file', log);
    }

    // --- 3. A staging run whose passphrase file is world- or group-readable
    //
    // 0644 is the mode a file picks up from an editor, a copy, or a default
    // umask, so this is the realistic wrong state rather than a contrived one.
    // The mode is asserted in the MESSAGE: "your file is wrong" and "your file
    // is wrong in this specific way" are a minute apart for the operator
    // reading it mid-rehearsal.
    {
        const pf = passphraseFile('over-readable.pass', 0o644);
        const log = join(work, 'argv-mode.txt');
        const r = run(['--input', stage(), '--staging', '--os', 'windows',
            '--passphrase-file', pf], { argvLog: log });
        check('a staging run with a 0644 passphrase file exits 2',
            r.status === 2, `exit ${r.status}: ${r.stderr}`);
        // Asserted as one contiguous `is mode 644`, which is only safe
        // because sign.sh reads the mode GNU-form-first. `stat -f` is
        // --file-system on GNU, so a BSD-first read prints a filesystem
        // block to stdout there and the fallback appends the real mode
        // after it; the refusal verdict survived that, the printed message
        // did not. Measured on a Linux host before the order was fixed.
        // If this assertion ever goes red on a venue but green on the Mac,
        // that ordering is what to look at first.
        check('and names the mode, contiguously, on either host',
            /is mode 644\b/.test(r.stderr), r.stderr);
        check('and says why the mode is the problem',
            /group or other/.test(r.stderr), r.stderr);
        neverSigned('staging + 0644 passphrase file', log);
    }

    // --- 3b. A staging run whose mode cannot be READ ----------------------
    //
    // The failure that hid the ordering bug rather than the ordering bug
    // itself. A garbled read used to leave the mode empty and the permission
    // check skipped, so a world-readable passphrase file sailed through the
    // one guard written to catch it: the run looked identical to a clean one,
    // because "we could not tell" resolved to "carry on".
    //
    // Driven with a stat that answers a filesystem dump, which is exactly what
    // the BSD-first read returned on Linux, so this case is the regression
    // guard for both halves at once. THE FIXTURE IS 0600, deliberately: the
    // only thing wrong with this run is that its mode could not be read, so a
    // refusal here cannot be case 3 firing under another name.
    {
        const pf = passphraseFile('unreadable-mode.pass', 0o600);
        check('fixture: the file really is 0600, so only the mode read is at fault',
            (statSync(pf).mode & 0o777) === 0o600, `mode ${(statSync(pf).mode & 0o777).toString(8)}`);
        // The stub is driven once directly, because a stub that quietly failed
        // to shadow the real stat would make this whole case pass for the
        // wrong reason: sign.sh would read a clean 600 and accept.
        const probe = spawnSync('stat', ['-c', '%a', pf],
            { encoding: 'utf8', env: { ...process.env, PATH: `${statBin}:${process.env.PATH}` } });
        check('fixture: the stub stat shadows the real one and garbles the read',
            probe.status === 0 && !/^[0-7]{3,4}$/.test(probe.stdout.trim()),
            `exit ${probe.status}: ${JSON.stringify(probe.stdout)}`);

        const log = join(work, 'argv-unreadable-mode.txt');
        const r = run(['--input', stage(), '--staging', '--os', 'windows',
            '--passphrase-file', pf], { argvLog: log, statStub: true });
        check('a staging run whose passphrase-file mode cannot be read exits 2',
            r.status === 2, `exit ${r.status}: ${r.stderr}`);
        check('and says the mode could not be read, naming the file',
            /could not read the mode of --passphrase-file/.test(r.stderr)
            && r.stderr.includes(pf), r.stderr);
        // Stated separately: a build that refused this run by claiming a mode
        // it never read would also exit 2 with a message naming the file, and
        // would be a different bug wearing this case's clothes.
        check('and does not claim a mode it could not read',
            !/is mode /.test(r.stderr), r.stderr);
        neverSigned('staging + unreadable passphrase-file mode', log);
    }

    // --- 4. The gpg invocation, both directions ---------------------------
    //
    // Two complete staging runs under the stub gpg. Neither signs anything;
    // both reach the last line of sign.sh, which is the only place the
    // argument list exists.
    const readArgv = (p) => {
        const raw = readFileSync(p, 'utf8');
        // One argument per line, with a trailing newline after the last, so
        // the final split element is a sentinel and not an argument. An
        // argument that IS empty shows up as an empty line before that.
        return raw === '' ? [] : raw.split('\n').slice(0, -1);
    };

    const plainDir = stage();
    const plainLog = join(work, 'argv-plain.txt');
    const plain = run(['--input', plainDir, '--staging', '--os', 'windows'],
        { argvLog: plainLog });
    check('a staging run with no passphrase file signs', plain.status === 0,
        `exit ${plain.status}: ${plain.stderr}`);

    const withDir = stage();
    const withLog = join(work, 'argv-with.txt');
    const acceptedPf = passphraseFile('accepted.pass', 0o600);
    const withFile = run(['--input', withDir, '--staging', '--os', 'windows',
        '--passphrase-file', acceptedPf], { argvLog: withLog });
    check('a staging run with a 0600 passphrase file signs', withFile.status === 0,
        `exit ${withFile.status}: ${withFile.stderr}`);
    // The accepting direction of case 3, and the only thing that stops
    // "refuse every mode" from satisfying it.
    check('and a 0600 file is not refused on its mode',
        !/is mode /.test(withFile.stderr), withFile.stderr);

    if (plain.status === 0 && withFile.status === 0) {
        const argvPlain = readArgv(plainLog);
        const argvWith = readArgv(withLog);

        const tail = (dir) => [
            '--local-user', KEY,
            '--armor',
            '--detach-sign',
            '--output', join(dir, 'RELEASE_HASHES.txt.asc'),
            join(dir, 'RELEASE_HASHES.txt'),
        ];

        // 4a. Without the flag, the argument list is the one it always was.
        check('gpg gets exactly its historical argument list with no passphrase file',
            JSON.stringify(argvPlain) === JSON.stringify(['--batch', '--yes', ...tail(plainDir)]),
            JSON.stringify(argvPlain, null, 1));
        // Stated separately, because the equality above would also be
        // satisfied by an argument list that never carried these at all: what
        // the ruling requires is that they are ABSENT here, not merely that
        // the list is short.
        check('and neither loopback argument appears on that path',
            !argvPlain.includes('--pinentry-mode') && !argvPlain.includes('--passphrase-file'),
            JSON.stringify(argvPlain));
        // The `set -u` idiom's own failure mode: an empty array expanded the
        // naive way reaches gpg as one empty positional argument, which gpg
        // reads as a filename. Invisible in the source, obvious here.
        check('and no empty argument leaks in from the empty array expansion',
            !argvPlain.includes(''), JSON.stringify(argvPlain));

        // 4b. With the flag, the pair is PREPENDED and nothing else moves.
        check('gpg gets the loopback pair prepended when a rehearsal supplies a file',
            JSON.stringify(argvWith) === JSON.stringify([
                '--batch', '--yes',
                '--pinentry-mode', 'loopback',
                '--passphrase-file', acceptedPf,
                ...tail(withDir),
            ]),
            JSON.stringify(argvWith, null, 1));

        // 4c. The two lists differ by exactly those four entries and nothing
        //     else. Asserted as a subtraction rather than by eye: the two runs
        //     write to different directories, so the --output and manifest
        //     paths differ legitimately, and comparing them naively would
        //     either fail or have to be loosened until it proved nothing.
        const stripped = argvWith.filter((a, i) => !(i >= 2 && i < 6));
        const rebased = stripped.map((a) => a.split(withDir).join(plainDir));
        check('the ONLY difference between the two invocations is the inserted pair',
            JSON.stringify(rebased) === JSON.stringify(argvPlain),
            `with:  ${JSON.stringify(rebased)}\nplain: ${JSON.stringify(argvPlain)}`);

        // The passphrase file is named to gpg by PATH and never by value, so
        // no run of this pipeline can put a passphrase in a process listing.
        // Cheap to check here, and the reason the flag takes a path at all.
        check('the passphrase reaches gpg as a path, never as a value',
            !argvWith.some((a) => a.includes(FAKE_PASSPHRASE.trim())),
            'an argument carried the fixture string itself');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} passphrase-source check(s) failed`);
    process.exit(1);
}

console.log(
    'OK: release passphrase-source smoke (`dq-9`, 2026-08-10: --passphrase-file is refused on a'
    + ' production run with the ruling stated, refused on a staging run when the file is unreadable'
    + ' or readable by group or other with the mode named, refused fail-closed when the mode itself'
    + ' cannot be read, and accepted at 0600 - where gpg is'
    + ' invoked with the loopback pair prepended and, without the flag, with the byte-identical'
    + ' argument list it always had and no empty argument from the empty-array expansion)',
);
