// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/release-record.mjs - the §6 release record: open it,
// require it, and prove every release tag has one.
//
// THE RULE THIS ENFORCES. §6 says the per-release record is instantiated
// from `claude/reports/wallet-releases/TEMPLATE.md` at the START of a
// release and closed by step 8. Until this file existed, nothing created
// it and nothing asked for it: v0.334.0 was tagged, built green and left
// half-finished while that directory still held only TEMPLATE.md, so for
// a day the only account of the first release this project ever attempted
// lived in GitHub's run history. The record was written retroactively,
// from the run's own summary job, which is a reconstruction rather than
// an account: it can only contain what a machine happened to log.
//
// So the record stops being a convention and becomes a precondition, in
// the same shape §7.5 already uses for the rehearsal record: a step
// refuses without it, and there is no skip switch. Two gates, at the two
// ends of a release:
//
//   step 1  the release gate (`pnpm test:smoke`, inside `pnpm ci`, inside
//           `pnpm release:gate`) demands a record for the version the
//           working tree DECLARES. The version bump is step 1 and the
//           bump commit is what step 2 pins the tag to, so a release
//           cannot acquire a validated commit before its record exists.
//   step 5  `publish.sh` refuses a production publish whose tag has no
//           instantiated record, beside the rehearsal gate it already runs.
//
// WHERE THE RECORDS LIVE, AND WHY THAT IS AWKWARD. In the PLATFORM repo,
// one level above this one, alongside the spec whose checklist they
// instantiate. That boundary is real and cannot be gated away: an
// isolated single-repo CI checkout has no platform repo above it, so the
// smoke half SKIPS there, loudly, exactly as the wallet's docs-parity
// smokes do since the prose moved out of this repo. What that costs is
// honest to state: GitHub CI cannot enforce this. What it does not cost is the
// gate, because publish.sh runs on the release machine, which is a full
// monorepo working tree, and there it is a hard refusal.
//
// WHAT COUNTS AS A RECORD. Not "a file exists". A byte-for-byte copy of
// TEMPLATE.md is the failure mode this is most likely to meet, because
// `cp TEMPLATE.md v0.336.0.md` is the cheapest way to make a gate shut
// up, so an untouched copy - and one that still carries the template's
// own "copy this file" instructions - is refused by name.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));            // tools/release
export const WALLET_ROOT = join(here, '..', '..');               // xchain-wallet

// Resolved from this file's own location, never cwd, so publish.sh, a
// smoke and an operator shell all read the same directory no matter
// where they were invoked from. The env override exists for a checkout
// whose platform repo is not the parent directory (a throwaway clone
// during a rollback, say); it relocates the records, it does not waive
// them.
export const RECORDS_DIR = process.env.XCHAIN_WALLET_RELEASE_RECORDS
    || join(WALLET_ROOT, '..', 'claude', 'reports', 'wallet-releases');

export const TEMPLATE_PATH = join(RECORDS_DIR, 'TEMPLATE.md');

/** Exit code for "the records directory is not in this checkout at all". */
export const EXIT_UNAVAILABLE = 3;

const TAG_RE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** `0.334.0` and `v0.334.0` both mean the tag `v0.334.0`. */
export function normalizeTag(input) {
    const raw = String(input || '').trim();
    const tag = raw.startsWith('v') ? raw : `v${raw}`;
    if (!TAG_RE.test(tag)) return null;
    return tag;
}

export function versionOf(tag) {
    const m = TAG_RE.exec(normalizeTag(tag) || '');
    return m ? m[1] : null;
}

/** True when the platform repo's records directory is in this checkout. */
export function recordsAvailable() {
    return existsSync(TEMPLATE_PATH);
}

export function recordPath(tag) {
    return join(RECORDS_DIR, `${normalizeTag(tag)}.md`);
}

/**
 * Inspect the record for one tag.
 *
 * Returns `{ ok, path, problems, closed }`. `problems` is empty iff a
 * record exists AND has actually been instantiated for this release;
 * every entry says what to do about it, because this is read by someone
 * mid-release who is already behind.
 */
export function inspectRecord(tag) {
    const normalized = normalizeTag(tag);
    const path = normalized ? recordPath(normalized) : null;

    if (!normalized) {
        return { ok: false, path, closed: false, problems: [`"${tag}" is not a vX.Y.Z release tag`] };
    }
    if (!existsSync(path)) {
        return {
            ok: false,
            path,
            closed: false,
            problems: [
                `no release record at ${path}`,
                `open it before going further: node tools/release/release-record.mjs open --tag ${normalized}`,
            ],
        };
    }

    return inspectBody(readFileSync(path, 'utf8'), normalized, path);
}

/**
 * The predicates themselves, over a record's text. Split out so the
 * default path and an explicit `--record <file>` are judged by the same
 * rules rather than by two drifting copies.
 */
function inspectBody(body, normalized, path) {
    const version = versionOf(normalized);
    const template = existsSync(TEMPLATE_PATH) ? readFileSync(TEMPLATE_PATH, 'utf8') : null;
    const problems = [];

    if (template !== null && body.trim() === template.trim()) {
        problems.push('the record is a byte-for-byte copy of TEMPLATE.md, so it records nothing');
    }
    if (/^Copy this file to /m.test(body)) {
        problems.push("the record still carries the template's own \"copy this file\" instructions");
    }
    if (/\bvX\.Y\.Z\b/.test(firstLine(body))) {
        problems.push('the title line still reads vX.Y.Z; it should name this release');
    }
    if (!fieldNames(body, 'Version', version)) {
        problems.push(`the **Version:** field does not read ${version}`);
    }
    if (!fieldNames(body, 'Tag', normalized)) {
        problems.push(`the **Tag:** field does not read ${normalized}`);
    }

    return { ok: problems.length === 0, path, problems, closed: isClosed(body) };
}

function firstLine(body) {
    return body.split('\n', 1)[0] || '';
}

/** True when the `**Name:**` field is present and names `wanted`. */
function fieldNames(body, name, wanted) {
    const m = new RegExp(`^\\*\\*${name}:\\*\\*(.*)$`, 'm').exec(body);
    if (!m) return false;
    return m[1].includes(wanted);
}

/**
 * Step 8 closes the record. Reported, never gated: the close-out happens
 * after the last store submission lands, which can be days after the
 * publish, so a gate on it would refuse the next release for the sin of
 * the previous one still being in review.
 */
function isClosed(body) {
    const m = /^\*\*Closed:\*\*(.*)$/m.exec(body);
    if (!m) return false;
    const value = m[1].trim();
    return value.length > 0 && !/^not closed\b/i.test(value);
}

// ------------------------------------------------------- opening a record

/**
 * Instantiate TEMPLATE.md for one release. Refuses to overwrite: a
 * record that already exists may hold the account of a release already
 * under way, and "the tool clobbered it" is the one way this can lose
 * the very thing it exists to keep.
 */
export function openRecord(tag, { manager = '', today = new Date() } = {}) {
    const normalized = normalizeTag(tag);
    if (!normalized) throw new Error(`"${tag}" is not a vX.Y.Z release tag`);
    if (!recordsAvailable()) {
        throw new Error(unavailableMessage());
    }
    const path = recordPath(normalized);
    if (existsSync(path)) {
        throw new Error(`${path} already exists; this never overwrites a record.`);
    }
    const version = versionOf(normalized);
    const date = today.toISOString().slice(0, 10);

    // Every pattern anchors with `[ \t]*$` rather than `\s*$`: `\s`
    // eats newlines, so the greedy form swallowed the blank line after
    // the title and welded the next paragraph onto the heading.
    let body = readFileSync(TEMPLATE_PATH, 'utf8');
    body = body.replace(/^# XChain Wallet release record - vX\.Y\.Z[ \t]*$/m,
        `# XChain Wallet release record - ${normalized}`);
    // The instruction paragraph is addressed to whoever copies the
    // template. Once copied, it is stale advice sitting inside the
    // artefact it produced, and `inspectRecord` refuses a record that
    // still carries it.
    body = body.replace(/^Copy this file to [\s\S]*?become known\.\n\n/m, '');
    body = body.replace(/^\*\*Version:\*\* X\.Y\.Z[ \t]*$/m, `**Version:** ${version}  `);
    body = body.replace(/^\*\*Tag:\*\* vX\.Y\.Z[ \t]*$/m, `**Tag:** ${normalized}  `);
    body = body.replace(/^\*\*Opened:\*\*[ \t]*$/m, `**Opened:** ${date}  `);
    if (manager) {
        body = body.replace(/^\*\*Release manager:\*\*[ \t]*$/m, `**Release manager:** ${manager}  `);
    }

    // Appended to the Store integers line rather than inserted under it:
    // the Identity block is a run of bold-label lines, and a paragraph
    // dropped into the middle of it splits the block in two.
    const integers = storeIntegers(normalized);
    if (integers) {
        body = body.replace(/^(\*\*Store integers:\*\* .*?)[ \t]*$/m,
            `$1 Computed ${date} for ${normalized}: \`${integers}\`.  `);
    }

    writeFileSync(path, body);
    return { path, version, tag: normalized, storeIntegers: integers };
}

/**
 * Ask the one authoritative source for the store integer rather than
 * restating §2's formula here. A prior audit found four variants of that
 * formula in the wild; a fifth is not wanted. A missing or broken script
 * leaves the line as the template wrote it rather than guessing.
 */
function storeIntegers(tag) {
    const script = join(WALLET_ROOT, 'packages', 'mobile', 'scripts', 'version.js');
    if (!existsSync(script)) return null;
    const r = spawnSync(process.execPath, [script, tag], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const out = String(r.stdout || '').trim();
    return out || null;
}

function unavailableMessage() {
    return `no release records directory at ${RECORDS_DIR}.\n`
        + '  The §6 records live in the PLATFORM repo, one level above this one\n'
        + '  (claude/reports/wallet-releases/). Check that repo out beside this\n'
        + '  one, or point XCHAIN_WALLET_RELEASE_RECORDS at it. This relocates\n'
        + '  the records; it does not waive them.';
}

// ------------------------------------------------------ tag-side coverage

const gitOut = (repo, args) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    return r.status === 0 ? String(r.stdout).trim() : null;
};

/**
 * Classify every `v*` tag in `repo`.
 *
 * Scope is deliberate and worth stating, because "every v* tag" is not
 * quite the rule. A tag whose commit's package.json declares a DIFFERENT
 * version is refused by release.yml's verify-tag gate and can therefore
 * never have produced a release, so demanding an account of it would
 * demand an account of something that never shipped - and would wedge
 * this gate on a malformed tag instead of on the missing record
 * it exists to catch. Those tags are reported, loudly, and belong to
 * verify-tag. Faking a pass by this rule means bumping every
 * version-bearing file and committing it, which is a release.
 */
export function tagCoverage(repo = WALLET_ROOT) {
    const listed = gitOut(repo, ['tag', '-l', 'v*']);
    if (listed === null) return { git: false, rows: [] };
    const tags = listed.split('\n').map((t) => t.trim()).filter(Boolean).sort();
    const rows = tags.map((tag) => {
        const normalized = normalizeTag(tag);
        if (!normalized) {
            return { tag, kind: 'not-a-version-tag', why: 'not a vX.Y.Z tag name' };
        }
        const pkg = gitOut(repo, ['show', `${tag}^{commit}:package.json`]);
        if (pkg === null) {
            return { tag, kind: 'unreadable', why: 'package.json is unreadable at that commit' };
        }
        let declared = null;
        try { declared = JSON.parse(pkg).version; } catch { /* handled below */ }
        if (!declared) {
            return { tag, kind: 'unreadable', why: 'package.json at that commit declares no version' };
        }
        if (declared !== versionOf(normalized)) {
            return {
                tag,
                kind: 'not-a-release',
                why: `package.json at that commit declares ${declared}, so release.yml's verify-tag refuses it`,
            };
        }
        return { tag, kind: 'release', ...inspectRecord(normalized) };
    });
    return { git: true, rows };
}

/** The version this working tree declares: step 1's half of the gate. */
export function declaredVersion(root = WALLET_ROOT) {
    const path = join(root, 'package.json');
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')).version || null; } catch { return null; }
}

// ------------------------------------------------------------------- CLI

const USAGE = `usage: release-record.mjs <command> [args]

  open --tag <vX.Y.Z> [--manager <name>]
      Instantiate TEMPLATE.md as this release's record (§6, step 1).
      Refuses to overwrite an existing record.

  path --tag <vX.Y.Z>
      Print where this release's record belongs.

  assert --tag <vX.Y.Z> [--record <file>]
      Require an instantiated record for this release. This is the gate
      publish.sh runs before a production publish; exits 1 with reasons.

  coverage [--repo <dir>]
      Every v* tag in the repo has a record, and the version this working
      tree declares has one too. Exits 1 if any is missing, ${EXIT_UNAVAILABLE} if the
      records directory is not in this checkout at all.
`;

function fail(msg) {
    process.stderr.write(`release-record.mjs: ${msg}\n`);
    process.exit(1);
}

function flag(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
    const command = argv[0];
    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(USAGE);
        return command ? 0 : 2;
    }

    if (command === 'path') {
        const tag = normalizeTag(flag(argv, '--tag') || fail('path needs --tag'));
        if (!tag) fail('--tag must be vX.Y.Z');
        process.stdout.write(`${recordPath(tag)}\n`);
        return 0;
    }

    if (command === 'open') {
        const tag = flag(argv, '--tag') || fail('open needs --tag <vX.Y.Z>');
        try {
            const made = openRecord(tag, { manager: flag(argv, '--manager') || '' });
            process.stdout.write(`ok   opened ${made.path}\n`);
            if (made.storeIntegers) {
                process.stdout.write(`     store integers: ${made.storeIntegers}\n`);
            }
            process.stdout.write('     Fill it in as the release happens; step 8 closes it.\n');
            return 0;
        } catch (err) {
            fail(String(err?.message || err));
        }
    }

    if (command === 'assert') {
        const tag = flag(argv, '--tag') || fail('assert needs --tag <vX.Y.Z>');
        const override = flag(argv, '--record');
        if (!recordsAvailable() && !override) {
            fail(unavailableMessage());
        }
        // `--record` names one file rather than a directory, so honour it
        // by pointing the resolver at its parent for this one call.
        const result = override
            ? inspectRecordAt(override, tag)
            : inspectRecord(tag);
        if (!result.ok) {
            process.stderr.write('release-record.mjs: this release has no usable §6 record.\n');
            for (const p of result.problems) process.stderr.write(`  - ${p}\n`);
            process.stderr.write(
                '  §6 instantiates the record at the START of a release and closes it at\n'
                + '  step 8. There is no skip switch, for the same reason the rehearsal gate\n'
                + '  has none: the release that is running late is the one most likely to\n'
                + '  skip it and the one most likely to need it.\n',
            );
            return 1;
        }
        process.stdout.write(`ok   release record ${result.path}`
            + `${result.closed ? ' (closed)' : ' (open)'}\n`);
        return 0;
    }

    if (command === 'coverage') {
        const repo = flag(argv, '--repo') || WALLET_ROOT;
        if (!recordsAvailable()) {
            process.stderr.write(`release-record.mjs: ${unavailableMessage()}\n`);
            return EXIT_UNAVAILABLE;
        }
        let missing = 0;
        const { git, rows } = tagCoverage(repo);
        if (!git) {
            process.stdout.write(`--   ${repo} is not a git checkout; no tags to cover\n`);
        }
        for (const row of rows) {
            if (row.kind === 'release') {
                if (row.ok) {
                    process.stdout.write(`✅ ${row.tag.padEnd(12)} ${row.path}${row.closed ? '' : ' (open)'}\n`);
                } else {
                    missing += 1;
                    process.stdout.write(`⬜ ${row.tag.padEnd(12)} ${row.problems[0]}\n`);
                }
            } else {
                process.stdout.write(`!! ${row.tag.padEnd(12)} not a release tag: ${row.why}\n`);
            }
        }

        const declared = declaredVersion(repo);
        if (declared) {
            const result = inspectRecord(`v${declared}`);
            if (result.ok) {
                process.stdout.write(`✅ ${`v${declared}`.padEnd(12)} declared by package.json\n`);
            } else {
                missing += 1;
                process.stdout.write(`⬜ ${`v${declared}`.padEnd(12)} declared by package.json: ${result.problems[0]}\n`);
            }
        }

        if (missing) {
            process.stdout.write(
                `\n${missing} release(s) have no §6 record. The record is instantiated at the\n`
                + 'START of a release, from TEMPLATE.md, and closed by step 8:\n'
                + '  node tools/release/release-record.mjs open --tag vX.Y.Z\n'
                + 'v0.334.0 shipped without one and had to be reconstructed a day later\n'
                + 'from a CI summary job, which is why this is a gate.\n',
            );
            return 1;
        }
        return 0;
    }

    fail(`unknown command "${command}"\n\n${USAGE}`);
    return 1;
}

/** `assert --record <file>`: inspect a record that lives off the default path. */
function inspectRecordAt(file, tag) {
    const normalized = normalizeTag(tag);
    if (!normalized) {
        return { ok: false, path: file, closed: false, problems: [`"${tag}" is not a vX.Y.Z release tag`] };
    }
    if (!existsSync(file)) {
        return {
            ok: false,
            path: file,
            closed: false,
            problems: [
                `no release record at ${file}`,
                `open one with: node tools/release/release-record.mjs open --tag ${normalized}`,
            ],
        };
    }
    return inspectBody(readFileSync(file, 'utf8'), normalized, file);
}

const invokedDirectly = process.argv[1]
    && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
    process.exit(main(process.argv.slice(2)));
}
