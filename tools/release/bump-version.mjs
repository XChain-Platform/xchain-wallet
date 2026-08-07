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

// tools/release/bump-version.mjs - write the release version into every
// place that declares it, in one pass ( §6 step 1, , ).
//
// WHY THIS EXISTS, and it is the half of the lockstep rule that was never
// built. `test/smoke/audits/version-lockstep.smoke.js` CHECKS that sixteen
// places agree; nothing PRODUCED that agreement, so every release bump has
// been sixteen hand edits made from a list held in somebody's head. It has
// already gone wrong the expensive way:  records a signed `v0.335.0`
// tag cut against a tree in which every file still declared 0.334.0, caught
// only by release.yml's tag-versus-package.json gate at the cost of a red
// release run on an irreversible artifact.
//
// MEMBERSHIP IS DERIVED FROM THE FILESYSTEM, exactly as the smoke derives
// it, and for the same reason: a hardcoded roster cannot know about a
// package added tomorrow, and a new package quietly shipping at 0.0.1 is
// the drift this rule exists to stop. Everything under packages/ carrying a
// package.json is in scope the moment it exists. The two files are
// deliberately two derivations of one rule from one source (the tree), not
// a producer and a copy of its own list: if this tool ever misses a place,
// the smoke is what says so, and a shared roster would have both of them
// blind together.
//
// THE CHANGELOG IS FAIL-SHUT. A release section with a heading and no
// entries passes every gate in this repo - the smoke asks whether the
// heading exists, which is the shape of the thing and not the substance -
// and it ships a release whose contents are undocumented at the moment it
// is tagged, which is exactly what buildInfo.js points a reader at the
// changelog for. So this tool refuses to bump while `## [Unreleased]` is
// empty. Write the entries first; that is editorial work and no tool can
// do it for you.
//
// Usage:
//   node tools/release/bump-version.mjs 0.337.0
//   node tools/release/bump-version.mjs v0.337.0 --date 2026-08-07
//   node tools/release/bump-version.mjs 0.337.0 --dry-run

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function usage() {
    process.stdout.write(`usage: bump-version.mjs <version> [--date YYYY-MM-DD] [--dry-run]

  Writes <version> into every place this repo declares it: the root
  package.json, every packages/*/package.json, the extension manifest's
  version and version_name, core's WALLET_VERSION, README's version badge
  and Status line, and a new CHANGELOG section carrying whatever
  "## [Unreleased]" holds.

  --date      the CHANGELOG section's date (default: today, UTC)
  --dry-run   print what would change and write nothing

  Refuses to run if "## [Unreleased]" is empty: a release section with a
  heading and no entries passes every gate here and documents nothing.

  Verify the result with:
    node test/smoke/audits/version-lockstep.smoke.js
`);
}

// --help before anything else reads the tree, so the tool can always say
// what it is even where it cannot run ( row 24: a tool answering
// "how do I use you" with its own failure vocabulary).
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(argv.length === 0 ? 2 : 0);
}

let target = null;
let date = new Date().toISOString().slice(0, 10);
let dryRun = false;
for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--date') { date = argv[i + 1]; i += 1; }
    else if (arg.startsWith('-')) fail(`unknown option ${arg}`);
    else if (target === null) target = arg.replace(/^v/, '');
    else fail(`unexpected argument ${arg}`);
}

function fail(msg, ...detail) {
    process.stderr.write(`bump-version.mjs: ${msg}\n`);
    for (const line of detail) process.stderr.write(`  ${line}\n`);
    process.exit(1);
}

if (!target) fail('no version given', 'usage: bump-version.mjs <version>');
if (!SEMVER.test(target)) {
    fail(`"${target}" is not a semver version`,
        'The root package.json version is what the release tag is derived from, and',
        'release.yml refuses any tag that is not exactly "v" + that string.');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date "${date}" is not YYYY-MM-DD`);

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const edits = [];              // { file, from, to, what }
const writes = new Map();      // file -> contents

function stage(file, contents, what, from, to) {
    writes.set(file, contents);
    edits.push({ file, what, from, to });
}

const current = JSON.parse(read('package.json')).version;
if (current === target) {
    fail(`the tree already declares ${target}`,
        'Nothing to do. If a previous bump was interrupted, run',
        'node test/smoke/audits/version-lockstep.smoke.js to find what it missed.');
}

// --- 1. The root and every package under packages/ ----------------------
//
// Version lives on its own line in these files and is rewritten by a
// targeted replacement rather than by JSON.stringify, which would reflow
// key order and indentation across ten files and bury the one-line change
// this commit is supposed to be.

const packageFiles = ['package.json'];
for (const name of readdirSync(join(ROOT, 'packages')).sort()) {
    const rel = join('packages', name, 'package.json');
    if (statSync(join(ROOT, 'packages', name)).isDirectory() && existsSync(join(ROOT, rel))) {
        packageFiles.push(rel);
    }
}

for (const rel of packageFiles) {
    const text = read(rel);
    const found = text.match(/^(\s*)"version":\s*"([^"]+)"/m);
    if (!found) fail(`${rel} has no "version" field in the expected shape`);
    const next = text.replace(/^(\s*)"version":\s*"([^"]+)"/m, `$1"version": "${target}"`);
    stage(rel, next, 'package version', found[2], target);
}

// --- 2. The store-facing copy -------------------------------------------
//
// The manifest is what the Chrome Web Store reads and displays, and it is
// the number the publish log and the rogue-publish monitor are keyed on
// . version_name is optional in MV3 and user-visible when present.

{
    const rel = 'packages/extension/manifest.json';
    const text = read(rel);
    const found = text.match(/^(\s*)"version":\s*"([^"]+)"/m);
    if (!found) fail(`${rel} has no "version" field in the expected shape`);
    let next = text.replace(/^(\s*)"version":\s*"([^"]+)"/m, `$1"version": "${target}"`);
    stage(rel, next, 'manifest version (the one the store publishes)', found[2], target);

    const named = next.match(/^(\s*)"version_name":\s*"([^"]+)"/m);
    if (named) {
        next = next.replace(/^(\s*)"version_name":\s*"([^"]+)"/m, `$1"version_name": "${target}"`);
        stage(rel, next, 'manifest version_name (what Chrome shows the user)', named[2], target);
    }
}

// --- 3. The copy the user sees ------------------------------------------

{
    const rel = 'packages/core/src/buildInfo.js';
    const text = read(rel);
    const found = text.match(/export const WALLET_VERSION = '([^']+)'/);
    if (!found) {
        fail(`${rel} no longer exports a WALLET_VERSION string literal`,
            'It is what the About panel and the diagnostic dump show a user.');
    }
    stage(rel, text.replace(/export const WALLET_VERSION = '([^']+)'/,
        `export const WALLET_VERSION = '${target}'`),
    'WALLET_VERSION (About panel, diagnostic dump)', found[1], target);
}

// --- 4. The prose copies ------------------------------------------------
//
// shields.io escapes a literal hyphen inside a badge label as `--`, so a
// prerelease reads `version-0.337.0--beta.1-blue`. The colour is left alone.

{
    const rel = 'README.md';
    let text = read(rel);
    const badge = text.match(/img\.shields\.io\/badge\/version-([^"]+?)-([A-Za-z]+)"/);
    if (!badge) fail(`${rel} no longer carries a shields.io version badge in the expected shape`);
    const escaped = target.replaceAll('-', '--');
    text = text.replace(/(img\.shields\.io\/badge\/version-)([^"]+?)(-[A-Za-z]+")/,
        `$1${escaped}$3`);
    stage(rel, text, 'README version badge', badge[1].replaceAll('--', '-'), target);

    const status = text.match(/current version: `([^`]+)`/);
    if (!status) fail(`${rel}'s Status section no longer states a "current version: \`X.Y.Z\`"`);
    text = text.replace(/current version: `([^`]+)`/, `current version: \`${target}\``);
    stage(rel, text, 'README Status line', status[1], target);
}

// --- 5. The CHANGELOG, and this is the fail-shut one --------------------

{
    const rel = 'CHANGELOG.md';
    const text = read(rel);
    const heading = new RegExp(`^## \\[${target.replaceAll('.', '\\.')}\\]`, 'm');
    if (heading.test(text)) {
        fail(`CHANGELOG.md already has a "## [${target}]" section`,
            'A previous bump got this far. Finish it by hand or revert it; this tool',
            'will not merge two sections claiming the same release.');
    }

    const start = text.indexOf('\n## [Unreleased]');
    if (start === -1) {
        fail('CHANGELOG.md has no "## [Unreleased]" section',
            'That is where changes accumulate between releases, and it is what this',
            'tool promotes into the new version section.');
    }
    const bodyStart = text.indexOf('\n', start + 1);
    const nextHeading = text.indexOf('\n## [', bodyStart);
    const body = (nextHeading === -1 ? text.slice(bodyStart) : text.slice(bodyStart, nextHeading)).trim();

    // The substance check. A heading with nothing under it satisfies every
    // gate in this repo and tells a reader nothing about what they are
    // installing, which is the state this refusal exists to end.
    if (!/^[-*] \S/m.test(body)) {
        const isPrerelease = target.includes('-');
        fail('"## [Unreleased]" carries no entries, so this bump would create an empty release section',
            isPrerelease
                ? 'Prereleases are exempt from the smoke\'s changelog check, but a release'
                : 'version-lockstep.smoke.js requires the section to exist;',
            'nothing requires it to say anything, which is why this refusal is here.',
            'Write the entries under "## [Unreleased]" first, one short sentence each,',
            'then re-run. `git log --oneline v<previous>..HEAD` is the raw material.');
    }

    const promoted = `\n## [Unreleased]\n\n## [${target}] - ${date}\n\n${body}\n`;
    const rest = nextHeading === -1 ? '' : text.slice(nextHeading);
    stage(rel, text.slice(0, start) + promoted + rest,
        `CHANGELOG section (${body.split('\n').filter((l) => /^[-*] \S/.test(l)).length} entries promoted from Unreleased)`,
        'Unreleased', `${target} - ${date}`);
}

// --- Report and write ---------------------------------------------------

process.stdout.write(`bump-version: ${current} -> ${target}${dryRun ? '  (dry run, nothing written)' : ''}\n`);
for (const edit of edits) {
    process.stdout.write(`  ${edit.file.padEnd(46)} ${edit.from} -> ${edit.to}   ${edit.what}\n`);
}

if (!dryRun) {
    for (const [rel, contents] of writes) writeFileSync(join(ROOT, rel), contents);
    process.stdout.write(`\nWrote ${writes.size} file(s). Now:\n`
        + '  node test/smoke/audits/version-lockstep.smoke.js\n'
        + `  node tools/release/release-record.mjs open --tag v${target}\n`
        + '  then green CI on the bump commit BEFORE the tag is cut ( §6 step 1)\n');
}
