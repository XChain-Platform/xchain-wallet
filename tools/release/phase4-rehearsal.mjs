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

// Records how deep a ceremony Phase 4 rehearsal actually got,
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
//                      the operator invokes, and so do the files lib.sh
//                      loads from its own directory.
//   the REPO side    - shipped-lanes.txt comes from the tree passed to
//                      --repo, which is the TAG's copy.
//
// The two signing controls (expected-artifacts.txt and the dev-mock gate)
// follow sign.sh's one control root per release set: the tag tree for a
// release run, the invoking checkout for a --staging rehearsal, where they are
// hashed and gated with the scripts. signingPathFiles() mirrors that mapping.
//
// The executable gates (verify-signatures.mjs, launch-probe.mjs) are a third
// kind: sign.sh runs the tag's copy where it exists and this checkout's copy
// only where the tag predates the gate, so a pin hashes whichever copy ran.
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
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WALLET_ROOT = resolve(HERE, '..', '..');
export const PIN_PATH = join(WALLET_ROOT, 'docs', 'phase4-rehearsal-pin.json');

// The files a Phase 4 run's behaviour actually depends on, split by which tree
// supplies them. Anything left out is drift nobody will see. The script side
// is gated against the pin. The repo side is the tag's copy, which sign.sh
// binds to the tag commit, so only a rehearsal at a newer tag can re-pin it:
// `check` reports its divergence from this checkout and does not fail on it.
const SIGNING_SCRIPTS = [
    'tools/release/sign.sh',
    'tools/release/verify.sh',
    'tools/release/lib.sh',
];
const LANE_ROSTER = 'tools/release/shipped-lanes.txt';
const DEV_MOCK_GATE = 'tools/build-reproduce/check-no-dev-mock.sh';
const SIGNING_CONTROLS = ['tools/release/expected-artifacts.txt', DEV_MOCK_GATE];

// The executable gates sign.sh runs before the manifest, resolved by its gate_script:
// the tag tree's copy wins, and this checkout's copy runs only when the tag predates the gate.
export const EXECUTABLE_GATES = [
    'tools/release/verify-signatures.mjs',
    'tools/release/launch-probe.mjs',
];

// List the files lib.sh loads from its own directory (`$here/...`), always the invoking checkout's copy.
export const LIB_SH_DEPENDENCIES = [
    'tools/release/update-info.mjs',
    'tools/release/store-profile-status.txt',
];

// Read a pin with no pinFormat with the fixed legacy split, which is what recorded it.
// Format 3 adds the executable gates and format 4 lib.sh's own-directory files;
// older formats keep the lists they were recorded with.
export const PIN_FORMAT = 4;

/**
 * The script-side and repo-side files for a release set, mirroring lib.sh's
 * xr_signing_control_root: staging reads both signing controls from the
 * invoking checkout, release reads them from the tag tree.
 *
 * From format 3 the executable gates join the repo side, because the tag's copy
 * wins. A gate named in `gateFallback` moves to the script side instead: sign.sh
 * ran this checkout's copy, so those are the bytes to hash and gate.
 *
 * From format 4 the files lib.sh loads from its own directory join the script
 * side for both release sets, since lib.sh is always the invoking checkout's.
 *
 * @param {string} releaseSet  'release' or 'staging'
 * @param {number} [pinFormat] the pin format to read; below 2 is the fixed legacy split
 * @param {{ gateFallback?: string[] }} [opts] gates the tag tree did not carry
 * @returns {{ script: string[], repo: string[] }}
 */
export function signingPathFiles(releaseSet, pinFormat = PIN_FORMAT, { gateFallback = [] } = {}) {
    if (releaseSet !== 'release' && releaseSet !== 'staging') {
        throw new Error(`phase4-rehearsal: unknown release set '${releaseSet}'`);
    }
    // Refuse a fallback naming a file that is not a gate, so a typo cannot drop a gate from both sides.
    const unknown = gateFallback.filter((p) => !EXECUTABLE_GATES.includes(p));
    if (unknown.length) throw new Error(`phase4-rehearsal: not an executable gate: ${unknown.join(', ')}`);
    if (pinFormat < 2) return { script: SIGNING_SCRIPTS, repo: [LANE_ROSTER, DEV_MOCK_GATE] };
    const split = releaseSet === 'staging'
        ? { script: [...SIGNING_SCRIPTS, ...SIGNING_CONTROLS], repo: [LANE_ROSTER] }
        : { script: SIGNING_SCRIPTS, repo: [LANE_ROSTER, ...SIGNING_CONTROLS] };
    if (pinFormat < 3) return split;
    const ownDir = pinFormat < 4 ? [] : LIB_SH_DEPENDENCIES;
    return {
        script: [...split.script, ...ownDir, ...EXECUTABLE_GATES.filter((p) => gateFallback.includes(p))],
        repo: [...split.repo, ...EXECUTABLE_GATES.filter((p) => !gateFallback.includes(p))],
    };
}

/** The file lists a written pin was recorded with; an absent releaseSet is a release run. */
export function pinPathFiles(pin) {
    return signingPathFiles(pin.releaseSet ?? 'release', pin.pinFormat ?? 1,
        { gateFallback: pin.gateFallback ?? [] });
}

/** The executable gates a tag tree does not carry, which sign.sh would run from this checkout. */
export function gateFallbackFor(repoRoot) {
    return EXECUTABLE_GATES.filter((p) => !existsSync(join(repoRoot, p)));
}

/** The executable gates sign.sh announced it ran from this checkout because the tag predates them. */
export function announcedGateFallback(output) {
    const announced = new Set();
    for (const m of String(output).matchAll(/predates (\S+) - running this checkout's copy/g)) {
        if (EXECUTABLE_GATES.includes(m[1])) announced.add(m[1]);
    }
    return EXECUTABLE_GATES.filter((p) => announced.has(p));
}

// The deepest step a run must have passed for sign.sh to have resolved each gate.
const GATE_RESOLVED_AFTER = {
    'tools/release/verify-signatures.mjs': 'artifact-set',
    'tools/release/launch-probe.mjs': 'signature-gate',
};

/**
 * Gates whose computed fallback disagrees with what sign.sh announced, judged only
 * for gates the run got far enough to resolve, so a pin never hashes the wrong copy.
 *
 * @param {{ computed: string[], output: string, reached: string }} args
 * @returns {string[]}
 */
export function gateFallbackMismatch({ computed, output, reached }) {
    const announced = announcedGateFallback(output);
    const depth = STEPS.indexOf(reached);
    return EXECUTABLE_GATES.filter((p) => depth >= STEPS.indexOf(GATE_RESOLVED_AFTER[p])
        && computed.includes(p) !== announced.includes(p));
}

// The steps a signing run passes through, deepest last. `reached` is the last
// one that succeeded, so it orders and a check can ask "did it get at least
// this far" rather than string-matching a message.
export const STEPS = [
    'invoked',
    'gpg-key-named',
    'dev-mock-gate',
    'lane-scope',
    'artifact-set',
    'signature-gate',
    'launch-probe',
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
export function dirtySigningPath(root = WALLET_ROOT, files = SIGNING_SCRIPTS) {
    const head = blobHashes(root, 'HEAD', files);
    const dirty = [];
    for (const p of files) {
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
export function classify(output) {
    if (/is not a lane declared in/.test(output)) return 'dev-mock-gate';
    if (/dev-mock gate exited 0 without saying it read anything/.test(output)) return 'gpg-key-named';
    // Match sign.sh's own dev-mock refusal before any vocabulary test: sign.sh exits right after it,
    // and the gate output it echoes says "missing", which the generic match below reads as lane scope.
    if (/pre-sign dev-mock gate FAILED/.test(output)) return 'gpg-key-named';
    if (/XCHAIN_RELEASE_GPG_KEY is not set/.test(output)) return 'invoked';
    if (/unknown argument/.test(output)) return 'invoked';
    // The gpg markers are tested FIRST, because reaching them means every
    // earlier step passed. They used to sit below the generic word match, and a
    // run that wrote a manifest and then failed at the signature was filed as
    // `lane-scope` on the strength of the word "missing" appearing anywhere in
    // the output - measured 2026-08-12 against the v0.339.0 set, where the pin
    // would have recorded `lane-scope` beside a blocker reading "signing
    // manifest with key ...". A later step's evidence outranks an earlier
    // step's vocabulary.
    if (/gpg: |No secret key|Inappropriate ioctl|passphrase/i.test(output)) return 'manifest-written';
    // Match the signature gate and launch probe on their own line-anchored words, deepest first,
    // above the generic match whose vocabulary (UNSIGNED, missing) both gates' refusals carry.
    // The spaced `launch probe:` progress line and the `predates` notice prove nothing, so neither matches.
    // Only the ok line proves a launch; a run that launched nothing stays at the signature gate.
    if (/^launch probe ok \(/m.test(output)) return 'launch-probe';
    if (/^launch-probe: |launch-probe\.mjs is in neither tree/m.test(output)) return 'signature-gate';
    if (/^signature gate ok \(/m.test(output)) return 'signature-gate';
    if (/^verify-signatures: |verify-signatures\.mjs is in neither tree/m.test(output)) return 'artifact-set';
    if (/UNSIGNED|UNDECLARED|missing/i.test(output)) return 'lane-scope';
    return 'invoked';
}

/**
 * Drive sign.sh's preconditions and report how deep they got.
 * Never writes anything; `pin` is what records an observation.
 */
export function probe({ repo, tag, input, lane, staging = false, env = {}, timeoutMs = 120000 }) {
    const signSh = join(WALLET_ROOT, 'tools', 'release', 'sign.sh');
    const args = ['--tag', tag, '--input', input, '--repo', repo];
    if (lane) args.unshift('--lane', lane);
    // WITHOUT THIS A REHEARSAL CANNOT REACH THE MANIFEST AT ALL, and that is
    // what the rehearsal drift turned out to be once it was chased past its first
    // symptom. `sign.sh` points its dev-mock gate at the SHIPPED bytes and
    // refuses a scan that covered nothing, so a tag whose own gate predates
    // `--artifacts` "reports OK having read nothing" and is correctly refused -
    // sign.sh's comment says so in as many words, and says it was measured
    // against v0.336.0. Its answer is `--staging`, which runs the TOOL tree's
    // gate against the last release's bytes, under the operator answer dq7
    // (2026-08-07) and for exactly this reason: "a rehearsal exercises the
    // CURRENT tooling against the LAST release's bytes."
    //
    // That mode existed in sign.sh and this tool had no way to ask for it, so
    // every rehearsal against a published tag died two steps early. `enforced`
    // stays honest either way: sign.sh's receipt check is untouched, so the
    // word is still written only if a gate really opened staged bundles and
    // said how many.
    if (staging) args.push('--staging');

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
// thing a run says before it stops. The two executable gates refuse under their
// own prefixes, so those count too (hyphenated `launch-probe:`, never the spaced progress line).
export function firstRefusal(output) {
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (/^(sign\.sh|release\/lib\.sh|verify-signatures|launch-probe):/.test(lines[i])) return lines[i];
    }
    return lines[lines.length - 1] || null;
}

function usage() {
    console.log(`usage: phase4-rehearsal.mjs <command> [args]

  probe --repo <dir> --tag <vX.Y.Z> --input <dir> [--lane <name>] [--staging]
      Drive ceremony Phase 4's signing preconditions and report the
      deepest step reached. Writes nothing.

  pin --repo <dir> --tag <vX.Y.Z> --input <dir> [--lane <name>] [--staging]
      Run probe, then record what it observed in
      docs/phase4-rehearsal-pin.json. Refuses to write a pin for a run
      it did not just watch.

  check [--against <ref>] [--pin <file>]
      Has the script side of the signing path moved since the pinned
      observation? Exits 1 naming every file that changed, 3 if there is
      no pin at all. Repo-side (tag tree) divergence is reported, not
      gated: only a rehearsal at a newer tag can re-pin it.

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
    const staging = argv.includes('--staging');
    if (!repo || !tag || !input) { usage(); process.exit(2); }
    // Decide before the dirty check, so a fallback gate with uncommitted edits blocks the pin.
    const gateFallback = gateFallbackFor(repo);
    const files = signingPathFiles(staging ? 'staging' : 'release', PIN_FORMAT, { gateFallback });

    const dirty = dirtySigningPath(WALLET_ROOT, files.script);
    if (dirty.length) {
        console.error('[phase4-rehearsal] refusing to pin: the signing path is dirty:');
        for (const p of dirty) console.error(`  ${p}`);
        console.error('\n  A pin is written to be committed and read by a later stage, so one recorded from'
            + '\n  uncommitted bytes describes a state nobody can reproduce. Commit or revert these'
            + '\n  first, then re-drive the rehearsal so the observation and the record are the same bytes.');
        return 1;
    }

    const result = probe({ repo, tag, input, lane, staging });
    // Refuse when sign.sh announces a control tree this mapping does not expect, so a pin never hashes the wrong copy.
    const announced = /signing controls come from the (tag|tool) tree/.exec(result.output)?.[1];
    const expectedTree = staging ? 'tool' : 'tag';
    if (announced && announced !== expectedTree) {
        console.error(`[phase4-rehearsal] refusing to pin: sign.sh read its signing controls from the ${announced} `
            + `tree, but this tool hashes them from the ${expectedTree} tree for this release set. `
            + 'Bring signingPathFiles() back in line with lib.sh xr_signing_control_root first.');
        return 1;
    }
    // Refuse when sign.sh ran a gate from a different tree than this tool hashes it from.
    const mismatched = gateFallbackMismatch({ computed: gateFallback, output: result.output, reached: result.reached });
    if (mismatched.length) {
        console.error('[phase4-rehearsal] refusing to pin: sign.sh resolved these gates from a different '
            + `tree than this tool expected: ${mismatched.join(', ')}. The tag tree's copy should win `
            + 'wherever it exists, and this checkout\'s copy should run only where the tag predates the gate. '
            + 'Bring gateFallbackFor() back in line with sign.sh gate_script first.');
        return 1;
    }
    // The commit that last touched the SIGNING PATH, not bare HEAD.
    //
    // HEAD moves on every unrelated commit, so pinning it would make the ref
    // look stale the moment anybody landed anything, and a pin that cries
    // stale on correct work is one people stop reading. The content hashes
    // below are the authority for drift; this ref is the human-readable answer
    // to "where did these bytes come from", so it should move only when they do.
    const scriptRef = git(WALLET_ROOT, ['log', '-1', '--format=%H', '--', ...files.script])
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
        pinFormat: PIN_FORMAT,
        tag,
        lane: lane || null,
        // Recorded because it changes WHICH copy of the dev-mock gate read the
        // bytes, and a reader of this pin should not have to infer that from
        // the blocker string.
        releaseSet: staging ? 'staging' : 'release',
        // Gates the tag predated, which sign.sh ran from this checkout and this pin hashes on the script side.
        gateFallback,
        reached: result.reached,
        reachedSignature: result.reached === 'signature',
        blocker: portable(result.blocker),
        scriptRef,
        repoRef,
        scriptPath: contentHashes(WALLET_ROOT, files.script),
        repoPath: contentHashes(repo, files.repo),
        observedAt: new Date().toISOString(),
    };
    writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 4)}\n`);
    console.log(`[phase4-rehearsal] pinned: reached '${result.reached}' at script ${String(scriptRef).slice(0, 8)} / repo ${String(repoRef).slice(0, 8)}`);
    if (result.blocker) console.log(`[phase4-rehearsal] blocker: ${result.blocker}`);
    return 0;
}

// DIRECTION MATTERS, and getting it wrong makes this gate a nuisance rather
// than a signal. "The bytes differ from the pin" has two opposite meanings:
//
//   the tree moved PAST the pin  - somebody changed the signing path after the
//                                  last rehearsal. The rehearsal is stale and
//                                  somebody has to re-drive it. RED.
//   the tree is BEHIND the pin   - this checkout has not pulled yet, and the
//                                  rehearsal describes NEWER tooling than the
//                                  one on disk. Nothing is wrong with the
//                                  rehearsal; `git pull` fixes the tree.
//
// Only the first is this gate's business. Measured, not theorised: the very
// first shared checkout this landed in was eleven commits behind origin, so
// the second reading fired there instantly, and this spec's own standing
// warning is that a check which fires on correct work is one people delete.
// The CI venue always tests the pushed commit, where the distinction cannot
// arise, so a behind-tree report would have been noise on every stale
// checkout and signal on none.
function isAncestor(root, a, b) {
    const r = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
    return r.status === 0;
}

export function drift({ pinFile = PIN_PATH, against = 'HEAD' } = {}) {
    if (!existsSync(pinFile)) return { ok: false, missing: true, moved: [] };
    const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
    const files = pinPathFiles(pin);
    const now = contentHashes(WALLET_ROOT, files.script);
    const moved = [];
    for (const p of files.script) {
        const then = pin.scriptPath?.[p] ?? null;
        if (then !== now[p]) moved.push({ path: p, pinned: then, now: now[p] });
    }

    // A tree that does not CONTAIN the pinned commit is behind it (or on an
    // unrelated branch), so its differing bytes are the old ones rather than
    // new ones. Reported as `behind` and not as drift. When the pinned ref
    // cannot be resolved at all - a shallow clone, or a pin from a commit that
    // never landed - we cannot tell the directions apart, and the honest
    // answer is the conservative one: report drift rather than assume behind,
    // because assuming behind is the reading that hides a real staleness.
    const resolvable = pin.scriptRef
        && spawnSync('git', ['-C', WALLET_ROOT, 'cat-file', '-e', `${pin.scriptRef}^{commit}`],
            { stdio: 'ignore' }).status === 0;
    const behind = moved.length > 0 && resolvable
        && !isAncestor(WALLET_ROOT, pin.scriptRef, against);

    return {
        ok: moved.length === 0 || behind, missing: false, moved, behind,
        repoDiverged: repoDivergence(pin), pin, files,
    };
}

/** Repo-side files whose copy in this checkout differs from the tag tree the rehearsal read. */
export function repoDivergence(pin) {
    const { repo } = pinPathFiles(pin);
    const now = contentHashes(WALLET_ROOT, repo);
    return repo
        .map((p) => ({ path: p, pinned: pin.repoPath?.[p] ?? null, now: now[p] }))
        .filter((m) => m.pinned !== m.now);
}

/** Signing-path files the current format tracks that a pin's older format never recorded. */
export function uncoveredByPin(pin) {
    const pinned = pinPathFiles(pin);
    const current = signingPathFiles(pin.releaseSet ?? 'release', PIN_FORMAT,
        { gateFallback: pin.gateFallback ?? [] });
    const had = new Set([...pinned.script, ...pinned.repo]);
    return [...current.script, ...current.repo].filter((p) => !had.has(p));
}

// Say which files an older pin cannot cover, so an OK line never implies it watched them.
function reportUncovered(pin) {
    const missing = uncoveredByPin(pin);
    if (!missing.length) return;
    console.log(`[phase4-rehearsal] NOTE, not gated: this pin (format ${pin.pinFormat ?? 1}) predates `
        + `${missing.length} signing-path file(s) the tool now tracks: ${missing.join(', ')}.`
        + '\n  Their drift is not covered until the rehearsal is re-driven and re-pinned.');
}

// Say what the gate did not compare, so a green line never claims the repo side.
function reportRepoSide(d) {
    if (!d.repoDiverged.length) {
        console.log(`[phase4-rehearsal] repo side: ${d.files.repo.length} files match the tag tree `
            + `the rehearsal read (${String(d.pin.repoRef).slice(0, 8)}).`);
        return;
    }
    console.log(`[phase4-rehearsal] NOTE, not gated: ${d.repoDiverged.length} of ${d.files.repo.length} `
        + `repo-side files differ from the tag tree the rehearsal read (${String(d.pin.repoRef).slice(0, 8)}, `
        + `tag ${d.pin.tag}): ${d.repoDiverged.map((m) => m.path).join(', ')}.`
        + '\n  The next tag\'s ceremony reads this checkout\'s copies, which no rehearsal has run against.'
        + '\n  Re-drive and re-pin against that tag once it is cut.');
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
    if (d.behind) {
        console.log(`[phase4-rehearsal] BEHIND: this checkout does not contain ${String(d.pin.scriptRef).slice(0, 8)}, the commit the rehearsal was observed at, so its `
            + `signing path is the OLDER one rather than a changed one. Not a stale rehearsal; pull `
            + `and this resolves. Differing: ${d.moved.map((m) => m.path).join(', ')}.`);
        return 0;
    }
    if (d.ok) {
        console.log(`[phase4-rehearsal] OK: the ${d.files.script.length} script-side signing-path files `
            + `at ${against} are byte-identical to the rehearsal pinned at ${String(d.pin.scriptRef).slice(0, 8)} `
            + `(reached '${d.pin.reached}', observed ${d.pin.observedAt}).`);
        reportRepoSide(d);
        reportUncovered(d.pin);
        return 0;
    }
    console.error(`[phase4-rehearsal] STALE: the signing path has moved since the rehearsal pinned at `
        + `${String(d.pin.scriptRef).slice(0, 8)}:`);
    for (const m of d.moved) console.error(`  ${m.path}`);
    reportRepoSide(d);
    reportUncovered(d.pin);
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
        const r = probe({ repo, tag, input, lane: arg(argv, '--lane'),
            staging: argv.includes('--staging') });
        console.log(`[phase4-rehearsal] reached: ${r.reached} (exit ${r.exitCode})`);
        if (r.blocker) console.log(`[phase4-rehearsal] blocker: ${r.blocker}`);
        return r.reached === 'signature' ? 0 : 1;
    }
    if (cmd === 'pin') return cmdPin(argv);
    if (cmd === 'check') return cmdCheck(argv);
    usage();
    return 2;
}

// Compare against the realpath as a URL, so a symlinked or spaced checkout still runs the CLI.
const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    process.exit(main());
}
