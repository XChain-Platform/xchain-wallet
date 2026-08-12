// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: tools/release/bump-version.mjs.
//
// version-lockstep.smoke.js checks the RESULT of a bump against the tree it
// runs in, which is the right check and cannot be the only one: it can only
// ever see the version this checkout already declares, so it says nothing
// about whether the tool that produced it would do the right thing on the
// next one. This drives the tool itself, in throwaway trees, so its
// refusals are exercised rather than described.
//
// The trees are scaffolds rather than copies of this repo. The tool
// resolves its root from its own location, so a scaffold is the only way to
// drive it without bumping the checkout the test is running in - and a
// scaffold is also what proves membership is derived: it carries a package
// this repo does not have, and the bump has to reach it.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const TOOL = join(root, 'tools', 'release', 'bump-version.mjs');

const CHANGELOG_WITH_ENTRIES = `# Changelog

## [Unreleased]

### Fixed
- A thing that was broken is no longer broken.

## [0.100.0] - 2026-01-01

### Added
- The first thing.
`;

const CHANGELOG_EMPTY_UNRELEASED = `# Changelog

## [Unreleased]

## [0.100.0] - 2026-01-01

### Added
- The first thing.
`;

// PACKAGES deliberately includes a name this repo does not ship. If the
// tool ever grows a hardcoded roster, this is the assertion that fails.
const PACKAGES = ['core', 'extension', 'invented-tomorrow'];

function scaffold(changelog) {
    const dir = mkdtempSync(join(tmpdir(), 'xchain-bump-'));
    mkdirSync(join(dir, 'tools', 'release'), { recursive: true });
    copyFileSync(TOOL, join(dir, 'tools', 'release', 'bump-version.mjs'));

    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'scaffold', version: '0.100.0' }, null, 4)}\n`);
    for (const name of PACKAGES) {
        mkdirSync(join(dir, 'packages', name), { recursive: true });
        writeFileSync(join(dir, 'packages', name, 'package.json'),
            `${JSON.stringify({ name: `@x/${name}`, version: '0.100.0' }, null, 4)}\n`);
    }
    mkdirSync(join(dir, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'core', 'src', 'buildInfo.js'),
        "export const WALLET_VERSION = '0.100.0';\n");
    writeFileSync(join(dir, 'packages', 'extension', 'manifest.json'),
        `${JSON.stringify({ manifest_version: 3, version: '0.100.0', version_name: '0.100.0' }, null, 4)}\n`);
    writeFileSync(join(dir, 'README.md'),
        '<img src="https://img.shields.io/badge/version-0.100.0-blue" alt="Version">\n\n'
        + 'Pre-v1.0 (current version: `0.100.0`).\n');
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
    return dir;
}

function run(dir, args) {
    try {
        const stdout = execFileSync(process.execPath,
            [join(dir, 'tools', 'release', 'bump-version.mjs'), ...args],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
    } catch (err) {
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
}

const trees = [];
const make = (changelog) => { const d = scaffold(changelog); trees.push(d); return d; };

try {
    // --- 1. --help answers without touching the tree ---------------------
    //
    // row 24: an operator-facing tool that answers "how do I use
    // you" with its own failure vocabulary is unusable at exactly the
    // moment it is typed. This one parses --help before it reads anything.

    const helpTree = make(CHANGELOG_WITH_ENTRIES);
    const help = run(helpTree, ['--help']);
    assert.equal(help.code, 0, `bump-version.mjs --help exited ${help.code}: ${help.stderr}`);
    assert.match(help.stdout, /usage: bump-version\.mjs/,
        'bump-version.mjs --help does not print a usage line.');
    assert.equal(readFileSync(join(helpTree, 'package.json'), 'utf8').includes('0.100.0'), true,
        '--help wrote to the tree. It must be answerable without side effects.');

    // --- 2. The bump reaches every declared place ------------------------

    const tree = make(CHANGELOG_WITH_ENTRIES);
    const bumped = run(tree, ['v0.101.0', '--date', '2026-02-02']);
    assert.equal(bumped.code, 0, `bump-version.mjs refused a valid bump: ${bumped.stderr}`);

    const version = (rel) => JSON.parse(readFileSync(join(tree, rel), 'utf8')).version;
    assert.equal(version('package.json'), '0.101.0', 'the root package.json was not bumped');
    for (const name of PACKAGES) {
        assert.equal(version(join('packages', name, 'package.json')), '0.101.0',
            `packages/${name} was not bumped. Membership is supposed to be derived from the filesystem, `
            + 'so a package this tool has never heard of must still be reached.');
    }

    const manifest = JSON.parse(readFileSync(join(tree, 'packages/extension/manifest.json'), 'utf8'));
    assert.equal(manifest.version, '0.101.0', 'the extension manifest version was not bumped');
    assert.equal(manifest.version_name, '0.101.0', 'the extension manifest version_name was not bumped');

    assert.match(readFileSync(join(tree, 'packages/core/src/buildInfo.js'), 'utf8'),
        /WALLET_VERSION = '0\.101\.0'/, 'WALLET_VERSION was not bumped');

    const readme = readFileSync(join(tree, 'README.md'), 'utf8');
    assert.match(readme, /badge\/version-0\.101\.0-blue/, "README's version badge was not bumped");
    assert.match(readme, /current version: `0\.101\.0`/, "README's Status line was not bumped");

    // The Unreleased entries move into the new section, and Unreleased
    // survives empty for the next cycle.
    const changelog = readFileSync(join(tree, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.101\.0\] - 2026-02-02\n\n### Fixed\n- A thing/,
        'the Unreleased section was not promoted into the new version section:\n'
        + changelog.split('\n').slice(0, 12).join('\n'));
    assert.match(changelog, /## \[0\.100\.0\] - 2026-01-01/,
        'the previous release section was lost by the promotion');

    // --- 3. An empty Unreleased is refused -------------------------------
    //
    // The reason this refusal exists rather than being left to judgement:
    // a section with a heading and no entries passes every gate in this
    // repo and documents nothing at the moment a tag makes it permanent.

    const emptyTree = make(CHANGELOG_EMPTY_UNRELEASED);
    const refused = run(emptyTree, ['0.101.0']);
    assert.equal(refused.code, 1,
        'bump-version.mjs accepted a bump with an empty "## [Unreleased]" section. That produces a release '
        + 'section carrying a heading and nothing else, which version-lockstep.smoke.js now also refuses.');
    assert.match(refused.stderr, /carries no entries/,
        `the refusal did not name its cause: ${refused.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(emptyTree, 'package.json'), 'utf8')).version, '0.100.0',
        'the refused bump still wrote to the tree. A refusal that half-applies is worse than no tool.');

    // --- 4. The other refusals -------------------------------------------

    const noop = run(tree, ['0.101.0']);
    assert.equal(noop.code, 1, 'bump-version.mjs re-bumped a tree that already declares that version');
    assert.match(noop.stderr, /already declares/, `unexpected refusal: ${noop.stderr}`);

    const rubbish = run(make(CHANGELOG_WITH_ENTRIES), ['not-a-version']);
    assert.equal(rubbish.code, 1, 'bump-version.mjs accepted a non-semver version');
    assert.match(rubbish.stderr, /is not a semver version/, `unexpected refusal: ${rubbish.stderr}`);

    // --- 5. --dry-run writes nothing -------------------------------------

    const dryTree = make(CHANGELOG_WITH_ENTRIES);
    const dry = run(dryTree, ['0.101.0', '--dry-run']);
    assert.equal(dry.code, 0, `--dry-run exited ${dry.code}: ${dry.stderr}`);
    assert.match(dry.stdout, /dry run, nothing written/, '--dry-run did not say it was a dry run');
    assert.equal(JSON.parse(readFileSync(join(dryTree, 'package.json'), 'utf8')).version, '0.100.0',
        '--dry-run wrote to the tree');
    assert.equal(readFileSync(join(dryTree, 'CHANGELOG.md'), 'utf8'), CHANGELOG_WITH_ENTRIES,
        '--dry-run rewrote the CHANGELOG');

    console.log('OK: release bump-version smoke (--help is side-effect free,'
        + `the bump reaches ${PACKAGES.length + 1} package.json files plus the manifest pair, WALLET_VERSION `
        + "and README's two prose copies, the Unreleased section is promoted with its entries, and an empty "
        + 'Unreleased, a repeat bump, a non-semver version and --dry-run all write nothing)');
} finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
}
