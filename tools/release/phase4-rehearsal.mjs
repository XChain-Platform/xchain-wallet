#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// row 89. Records how deep a ceremony Phase 4 rehearsal actually got,
// and against which commits, so the next stage can tell whether that
// observation still describes the tooling the ceremony would run today.
//
// WHY THIS EXISTS, and it is a measured history rather than a precaution.
// Phase 4 has been rehearsed by hand three times and the anchor has rotted
// under it every time:
//
//   S38 rehearsed at one commit; S40 found the rehearsal had been driven
//        against the wrong tree entirely.
//   S41 (row 61) found "the commit a tag would now name rewrote the entire
//        signing path underneath that rehearsal", and re-drove it at 42bda8b1.
//   S47 (this file) found the same decay again, six commits later: sign.sh
//        +100 lines, lib.sh +177, shipped-lanes.txt 28 lines changed.
//
// Each time it was caught by a human diffing a ref out of a frontier row's
// evidence cell. Nothing recorded which commit the last rehearsal was driven
// at, so nothing could notice when the signing path moved past it.
//
// THE TWO-TREE SPLIT IS THE WHOLE SUBTLETY, and it is what rows 40, 48 and 57
// each got wrong in turn. A Phase 4 signing run reads from TWO trees at once:
//
//   the SCRIPT side  - sign.sh, verify.sh and lib.sh come from the checkout
//                      the operator invokes.
//   the REPO side    - shipped-lanes.txt and the dev-mock gate come from the
//                      tree passed to --repo, which is the TAG's copy.
//
// A pin naming one ref would therefore be a lie by omission half the time,
// which is precisely how "rehearsed end to end" survived three stages while
// meaning something different each time. Both refs are recorded.
//
// THE PIN IS AN OBSERVATION, NEVER AN ASSERTION - the convention
// docs/release-key-pin.json and docs/privacy-deploy-pin.json already set here.
// `pin` refuses to write anything it did not just watch happen, and it records
// the deepest step REACHED rather than a pass, because a Phase 4 rehearsal
// that stops short is the normal case: the signature itself needs K1's
// passphrase at a pinentry, which no automated run can supply.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WALLET_ROOT = resolve(HERE, '..', '..');
export const PIN_PATH = join(WALLET_ROOT, 'docs', 'phase4-rehearsal-pin.json');

// The files a Phase 4 run's behaviour actually depends on, split by which tree
// supplies them. Anything added here becomes something the drift check can
// notice; anything left out is drift nobody will see.
export const SCRIPT_PATH_FILES = [
    'tools/release/sign.sh',
    'tools/release/verify.sh',
    'tools/release/lib.sh',
];
export const REPO_PATH_FILES = [
    'tools/release/shipped-lanes.txt',
    'tools/build-reproduce/check-no-dev-mock.sh',
];

// The steps a signing run passes through, deepest last. `reached` is the last
// one that succeeded, so it orders and a check can ask "did it get at least
// this far" rather than string-matching a message.
export const STEPS = [
    'invoked',
    'gpg-key-named',
    'dev-mock-gate',
    'lane-scope',
    'artifact-set',
    'manifest-written',
    'signature',
];

function git(root, args) {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}

/** The git blob hash of each path at a ref, or null where the path is absent. */
export function blobHashes(root, ref, paths) {
    const out = {};
    for (const p of paths) out[p] = git(root, ['rev-parse', `${ref}:${p}`]);
    return out;
}

// The hash of the bytes ON DISK, which are the bytes a run actually executes.
//
// THIS IS A CORRECTION, AND IT IS THE ONE THIS FILE'S FIRST FALSIFICATION
// CAUGHT. The first cut compared `HEAD:<path>` blobs on both sides, so
// appending a line to sign.sh in the working tree changed nothing the gate
// could see - and, far worse, `pin` would then record HEAD's hash while
// `probe` had just executed the modified working-tree copy. A pin can only be
// worth anything if it names the bytes that ran, so both sides hash the file
// on disk.
export function contentHashes(root, paths) {
    const out = {};
    for (const p of paths) {
        const full = join(root, p);
        out[p] = existsSync(full)
            ? createHash('sha256').update(readFileSync(full)).digest('hex')
            : null;
    }
    return out;
}

/**
 * Signing-path files that differ from HEAD.
 *
 * A pin is written to be committed and read by a later stage, so one recorded
 * from a dirty tree describes bytes nobody else can ever reproduce. `pin`
 * refuses rather than recording an observation that cannot be checked again.
 */
export function dirtySigningPath(root = WALLET_ROOT) {
    const head = blobHashes(root, 'HEAD', SCRIPT_PATH_FILES);
    const dirty = [];
    for (const p of SCRIPT_PATH_FILES) {
        const onDisk = git(root, ['hash-object', join(root, p)]);
        if (onDisk !== head[p]) dirty.push(p);
    }
    return dirty;
}

// Classify sign.sh's own refusal into the step it died at. The strings are
// matched against the script's OWN messages, so a reworded refusal falls
// through to the conservative answer rather than silently claiming depth: an
// unrecognised failure reports the step BEFORE the shallowest thing it could
// be, never a deeper one.
function classify(output) {
    if (/is not a lane declared in/.test(output)) return 'dev-mock-gate';
    if (/dev-mock gate exited 0 without saying it read anything/.test(output)) return 'gpg-key-named';
    if (/XCHAIN_RELEASE_GPG_KEY is not set/.test(output)) return 'invoked';
    if (/unknown argument/.test(output)) return 'invoked';
    if (/UNSIGNED|UNDECLARED|missing/i.test(output)) return 'lane-scope';
    if (/gpg: |No secret key|Inappropriate ioctl|passphrase/i.test(output)) return 'manifest-written';
    return 'invoked';
}

/**
 * Drive sign.sh's preconditions and report how deep they got.
 * Never writes anything; `pin` is what records an observation.
 */
export function probe({ repo, tag, input, lane, env = {}, timeoutMs = 120000 }) {
    const signSh = join(WALLET_ROOT, 'tools', 'release', 'sign.sh');
    const args = ['--tag', tag, '--input', input, '--repo', repo];
    if (lane) args.unshift('--lane', lane);

    const r = spawnSync('bash', [signSh, ...args], {
        encoding: 'utf8',
        timeout: timeoutMs,
        // stdin closed so a pinentry can never block an automated run. The
        // signature step is expected to be unreachable here and that is the
        // honest outcome, not a failure of this tool.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
    });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    const reached = r.status === 0 ? 'signature' : classify(output);
    return {
        reached,
        exitCode: r.status,
        blocker: r.status === 0 ? null : firstRefusal(output),
        output,
    };
}

// The refusal line itself, so the pin carries the tooling's own words rather
// than this file's paraphrase of them.
//
// The LAST such line, not the first, and that is a correction rather than a
// preference: sign.sh narrates its progress with the same `sign.sh:` prefix it
// refuses with ("running pre-sign dev-mock gate against ..."), so taking the
// first one pinned a progress message as the blocker. A refusal is the last
// thing a run says before it stops.
function firstRefusal(output) {
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (/^(sign\.sh|release\/lib\.sh):/.test(lines[i])) return lines[i];
    }
    return lines[lines.length - 1] || null;
}

function usage() {
    console.log(`usage: phase4-rehearsal.mjs <command> [args]

  probe --repo <dir> --tag <vX.Y.Z> --input <dir> [--lane <name>]
      Drive ceremony Phase 4's signing preconditions and report the
      deepest step reached. Writes nothing.

  pin --repo <dir> --tag <vX.Y.Z> --input <dir> [--lane <name>]
      Run probe, then record what it observed in
      docs/phase4-rehearsal-pin.json. Refuses to write a pin for a run
      it did not just watch.

  check [--against <ref>] [--pin <file>]
      Has the signing path moved since the pinned observation? Exits 1
      naming every file that changed, 3 if there is no pin at all.

Exit codes: 0 clean, 1 drift or a failed probe, 2 usage, 3 no pin.`);
}

function arg(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
}

function cmdPin(argv) {
    const repo = arg(argv, '--repo');
    const tag = arg(argv, '--tag');
    const input = arg(argv, '--input');
    const lane = arg(argv, '--lane');
    if (!repo || !tag || !input) { usage(); process.exit(2); }

    const dirty = dirtySigningPath();
    if (dirty.length) {
        console.error('[phase4-rehearsal] refusing to pin: the signing path is dirty:');
        for (const p of dirty) console.error(`  ${p}`);
        console.error('\n  A pin is written to be committed and read by a later stage, so one recorded from'
            + '\n  uncommitted bytes describes a state nobody can reproduce. Commit or revert these'
            + '\n  first, then re-drive the rehearsal so the observation and the record are the same bytes.');
        return 1;
    }

    const result = probe({ repo, tag, input, lane });
    // The commit that last touched the SIGNING PATH, not bare HEAD.
    //
    // HEAD moves on every unrelated commit, so pinning it would make the ref
    // look stale the moment anybody landed anything, and a pin that cries
    // stale on correct work is one people stop reading. The content hashes
    // below are the authority for drift; this ref is the human-readable answer
    // to "where did these bytes come from", so it should move only when they do.
    const scriptRef = git(WALLET_ROOT, ['log', '-1', '--format=%H', '--', ...SCRIPT_PATH_FILES])
        || git(WALLET_ROOT, ['rev-parse', 'HEAD']);
    const repoRef = git(repo, ['rev-parse', 'HEAD']);

    // The tooling quotes the absolute --repo path back in its refusals, and a
    // rehearsal is driven from a throwaway worktree that will not exist by the
    // time anybody reads this pin. Recording it verbatim would bake a dead
    // absolute path into a committed file, which is the citation-rot class this
    // spec keeps finding one layer out. The refusal's own words are kept; only
    // the two paths that are environment rather than evidence are normalized.
    const portable = (s) => (s === null ? null : s
        .split(resolve(repo)).join('<repo>')
        .split(resolve(input)).join('<input>'));

    const pin = {
        _comment: 'Written by tools/release/phase4-rehearsal.mjs from a run it just watched. '
            + 'Records how deep a ceremony Phase 4 rehearsal got and against which two trees. '
            + 'Do not hand-edit: the value of this file is that only an observation can set it. '
            + 'A `reached` short of "signature" is the NORMAL case, not a defect - the signature '
            + 'needs K1 at a pinentry and no automated run can supply it.',
        tag,
        lane: lane || null,
        reached: result.reached,
        reachedSignature: result.reached === 'signature',
        blocker: portable(result.blocker),
        scriptRef,
        repoRef,
        scriptPath: contentHashes(WALLET_ROOT, SCRIPT_PATH_FILES),
        repoPath: contentHashes(repo, REPO_PATH_FILES),
        observedAt: new Date().toISOString(),
    };
    writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 4)}\n`);
    console.log(`[phase4-rehearsal] pinned: reached '${result.reached}' at script ${String(scriptRef).slice(0, 8)} / repo ${String(repoRef).slice(0, 8)}`);
    if (result.blocker) console.log(`[phase4-rehearsal] blocker: ${result.blocker}`);
    return 0;
}

export function drift({ pinFile = PIN_PATH, against = 'HEAD' } = {}) {
    if (!existsSync(pinFile)) return { ok: false, missing: true, moved: [] };
    const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
    const now = contentHashes(WALLET_ROOT, SCRIPT_PATH_FILES);
    const moved = [];
    for (const p of SCRIPT_PATH_FILES) {
        const then = pin.scriptPath?.[p] ?? null;
        if (then !== now[p]) moved.push({ path: p, pinned: then, now: now[p] });
    }
    return { ok: moved.length === 0, missing: false, moved, pin };
}

function cmdCheck(argv) {
    const against = arg(argv, '--against') || 'HEAD';
    const pinFile = arg(argv, '--pin') || PIN_PATH;
    const d = drift({ pinFile, against });
    if (d.missing) {
        console.error('[phase4-rehearsal] no pin at ' + pinFile
            + '\n  Nothing records where Phase 4 was last rehearsed, which is the state that let'
            + '\n  the anchor rot three times. Run `pin` after driving a rehearsal.');
        return 3;
    }
    if (d.ok) {
        console.log(`[phase4-rehearsal] OK: the signing path at ${against} is byte-identical to the `
            + `rehearsal pinned at ${String(d.pin.scriptRef).slice(0, 8)} `
            + `(reached '${d.pin.reached}', observed ${d.pin.observedAt}).`);
        return 0;
    }
    console.error(`[phase4-rehearsal] STALE: the signing path has moved since the rehearsal pinned at `
        + `${String(d.pin.scriptRef).slice(0, 8)}:`);
    for (const m of d.moved) console.error(`  ${m.path}`);
    console.error('\n  The recorded observation no longer describes the tooling ceremony Phase 4 would'
        + '\n  run, so "Phase 4 is rehearsed" is a claim about a tree that has moved on. Re-drive the'
        + '\n  rehearsal and re-pin it, or record in the release record why these changes cannot affect'
        + '\n  the signing path. Do not hand-edit the pin: that turns an observation into an assertion,'
        + '\n  which is the one thing it exists not to be.');
    return 1;
}

function main() {
    const [, , cmd, ...argv] = process.argv;
    if (!cmd || cmd === '--help' || cmd === '-h') { usage(); return 0; }
    if (cmd === 'probe') {
        const repo = arg(argv, '--repo');
        const tag = arg(argv, '--tag');
        const input = arg(argv, '--input');
        if (!repo || !tag || !input) { usage(); return 2; }
        const r = probe({ repo, tag, input, lane: arg(argv, '--lane') });
        console.log(`[phase4-rehearsal] reached: ${r.reached} (exit ${r.exitCode})`);
        if (r.blocker) console.log(`[phase4-rehearsal] blocker: ${r.blocker}`);
        return r.reached === 'signature' ? 0 : 1;
    }
    if (cmd === 'pin') return cmdPin(argv);
    if (cmd === 'check') return cmdCheck(argv);
    usage();
    return 2;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    process.exit(main());
}
