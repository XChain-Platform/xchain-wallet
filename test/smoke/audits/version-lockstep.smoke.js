// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: every package ships at the root's version.
//
// The README's Versioning section states the rule and gives its purpose:
// every shell's About screen shows its own package.json version "so users
// can confirm the extension, web, and desktop builds came from the same
// codebase". A user comparing two shells that disagree learns the opposite
// of what that sentence promises.
//
// It drifted anyway. On 2026-08-01 six packages sat a patch version behind
// the root (core, web, bridge-spec, test-dapp, signers-ledger,
// signers-trezor at 0.333.0 against a root of 0.333.1) while the README
// claimed they were in lockstep, and nothing anywhere noticed. There was
// no bump tool and no check; the rule existed only as prose.
//
// MEMBERSHIP IS DERIVED FROM THE FILESYSTEM, not from a list in this file
// and not from the list the README used to carry. A hardcoded roster is
// exactly what failed: it cannot know about a package added tomorrow, and
// a new package that quietly ships at 0.0.1 is the same defect wearing a
// different hat. Everything under packages/ is in scope the moment it
// exists.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const rootVersion = readJson('package.json').version;
assert.match(rootVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    `the root package.json version "${rootVersion}" is not a semver string, and it is the source every `
    + 'other version and the release tag are derived from');

// --- 1. Every package under packages/ tracks the root ------------------

const packagesDir = join(root, 'packages');
const members = readdirSync(packagesDir)
    .filter((name) => statSync(join(packagesDir, name)).isDirectory())
    .filter((name) => existsSync(join(packagesDir, name, 'package.json')))
    .sort();

assert.ok(members.length >= 6,
    `found only ${members.length} packages under packages/; expected at least 6. If the layout moved, this `
    + 'check is now enforcing the rule over almost nothing.');

const drifted = [];
for (const name of members) {
    const version = readJson(join('packages', name, 'package.json')).version;
    if (version !== rootVersion) drifted.push(`packages/${name} is at ${version}`);
}

assert.deepEqual(drifted, [],
    `these packages do not ship at the root version (${rootVersion}): ${drifted.join(', ')}. The README's `
    + 'Versioning section promises that a user can compare two shells\' About screens to confirm they came '
    + 'from the same codebase, and a split version tells them the opposite. Bump every member together, in '
    + 'one commit.');

// --- 2. The store-facing copy of the version ---------------------------
//
// manifest.json carries its own version field and it is the one the Chrome
// Web Store reads and displays. package.json agreeing with the root while
// the manifest lags means the store publishes a version this repo does not
// think it shipped, which is also the number the publish log and the
// rogue-publish monitor are keyed on.

const manifestVersion = readJson('packages/extension/manifest.json').version;
assert.equal(manifestVersion, rootVersion,
    `packages/extension/manifest.json is at ${manifestVersion} but the root is at ${rootVersion}. The store `
    + 'reads the manifest, so this is the version that would go live, be written into publish-log.md, and be '
    + 'compared by the store-version monitor.');

// version_name is optional in MV3; when present it is user-visible and must
// not contradict the version it sits beside.
const manifest = readJson('packages/extension/manifest.json');
if (manifest.version_name) {
    assert.ok(manifest.version_name.startsWith(rootVersion),
        `manifest.json version_name "${manifest.version_name}" does not start with the shipped version `
        + `"${rootVersion}". version_name is what Chrome shows the user on the extensions page.`);
}

// --- 3. The copy the USER sees -----------------------------------------
//
// packages/core/src/buildInfo.js exports WALLET_VERSION, which is what the
// About panel and the diagnostic dump display. It is the copy that matters
// most and it is the one that went wrong quietest: it sat at 0.333.0 while
// the root and the shipped extension were at 0.333.1, so About
// under-reported the build. The only check on it compared this constant to
// core's OWN package.json, and core was equally stale, so the pair agreed
// with each other and disagreed with the product. It is pinned to the ROOT
// here for that reason.

const buildInfo = readFileSync(join(root, 'packages/core/src/buildInfo.js'), 'utf8');
const declared = buildInfo.match(/export const WALLET_VERSION = '([^']+)'/);
assert.ok(declared,
    'packages/core/src/buildInfo.js no longer exports a WALLET_VERSION string literal in the expected '
    + 'shape. It is what the About panel shows a user; if it moved, this check has to move with it.');
assert.equal(declared[1], rootVersion,
    `buildInfo.js WALLET_VERSION is ${declared[1]} but the root is at ${rootVersion}. This is the version `
    + 'the About panel and the diagnostic dump show, so a user comparing two shells (which is exactly what '
    + 'the README tells them to do) would be told the build is older than it is.');

// --- 4. The documented exemption ---------------------------------------
//
// test/e2e is a private harness: never published, never installed, so its
// Version identifies nothing. That is a decision (2026-08-01), so
// it is recorded in the README rather than merely being true, and checked
// here in both directions so it cannot rot into an unexplained exception.

const E2E = 'test/e2e/package.json';
const readme = readFileSync(join(root, 'README.md'), 'utf8');

if (existsSync(join(root, E2E))) {
    assert.ok(/`test\/e2e` is exempt/.test(readme),
        'test/e2e carries its own version but the README no longer documents the exemption. An undocumented '
        + 'exception is indistinguishable from drift the next time someone audits this.');
} else {
    assert.ok(!/`test\/e2e` is exempt/.test(readme),
        'the README documents a test/e2e exemption, but test/e2e/package.json no longer exists. Remove the '
        + 'exemption so it does not excuse something else later.');
}

// The rule itself has to stay written down: this check enforces it, the
// README is where a human learns it.
assert.ok(/ships? at the same version number/.test(readme),
    'README.md no longer states the lockstep rule. The check would still pass silently while the only '
    + 'human-readable statement of the invariant was gone.');

// --- 5. The prose copies of the version --------------------------------
//
//The lockstep set is 14 files, and until now this check covered
// 12 of them: the ten package.json files, the manifest and buildInfo. The
// two it did not cover are the two a human reads first, README.md's version
// badge and its Status line, and both spell the number out in prose where
// nothing derives it.
//
// That gap is the shape of the defect was filed for. A signed
// `v0.335.0` tag was cut against a tree in which every file still declared
// 0.334.0, so the tag named a version no file in the repo claimed, and
// release.yml's tag-versus-package.json gate is the only thing that caught
// it - at the cost of a red release run. A bump that lands in the manifests
// and stops short of the README leaves the same contradiction behind in the
// place a reader trusts most.

// shields.io spells the badge as `version-<label>-<color>` and escapes a
// literal hyphen inside the label as `--`, so a prerelease reads
// `version-0.335.0--beta.1-blue`. The color is stripped off the end rather
// than matched by name (it is presentation and may change), and the escape
// is undone afterwards, or every prerelease would read as a mismatch.
const badge = readme.match(/img\.shields\.io\/badge\/version-([^"]+)/);
assert.ok(badge,
    'README.md no longer carries a shields.io version badge in the expected shape. It is the first version '
    + 'statement a reader sees, so if it moved, this check has to move with it.');
const badgeVersion = badge[1].slice(0, badge[1].lastIndexOf('-')).replaceAll('--', '-');
assert.equal(badgeVersion, rootVersion,
    `README.md's version badge reads ${badgeVersion} but the root is at ${rootVersion}. `
    + 'The badge is the first thing a reader sees, and it is rendered from a remote image URL, so nothing '
    + 'else in the repo will ever contradict it out loud.');

const status = readme.match(/current version: `([^`]+)`/);
assert.ok(status,
    'README.md\'s Status section no longer states a "current version: `X.Y.Z`". It is the sentence that '
    + 'tells a reader what this checkout is, and a version-bump check that cannot find it enforces nothing.');
assert.equal(status[1], rootVersion,
    `README.md's Status section says the current version is ${status[1]} but the root is at ${rootVersion}. `
    + 'A bump that stopped at the manifests leaves the README claiming the previous release.');

// The changelog is where the version's release context lives - buildInfo.js
// says so in its own comment. A version with no section there is a release
// whose contents are undocumented at the moment it is tagged.
//
// Prereleases are exempt: the beta and respin lanes (packages/mobile/
// scripts/version.js) ride the version they are betas OF, and they are not
// separate releases to write up.

const isPrerelease = rootVersion.includes('-');
let entryCount = 0;
if (!isPrerelease) {
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    const heading = new RegExp(`^## \\[${rootVersion.replaceAll('.', '\\.')}\\]`, 'm');
    assert.ok(heading.test(changelog),
        `CHANGELOG.md has no "## [${rootVersion}]" section, but that is the version this tree declares and `
        + 'the one a release tag would name. buildInfo.js points a reader at the changelog for the version\'s '
        + 'release context; a bump that skips it ships a version with no recorded contents.');

    // The heading is the SHAPE of the record. This is the substance, and
    // until S39 nothing anywhere asked for it: a section consisting
    // of a heading and nothing else satisfied the assertion above, passed
    // every gate in this repo, and shipped a release whose contents are
    // undocumented at the exact moment the tag makes them permanent. That
    // is not hypothetical either - `## [Unreleased]` sat empty across the
    // 26 commits between v0.336.0 and the bump that follows it, so a bump
    // taken then would have created exactly that section.
    //
    // tools/release/bump-version.mjs refuses to CREATE one, which stops the
    // tool-driven path. This is the gate that also covers the hand-edited
    // one, because the tool is a convenience and the rule is not.
    const start = changelog.search(heading);
    const after = changelog.indexOf('\n## [', start + 1);
    const section = after === -1 ? changelog.slice(start) : changelog.slice(start, after);
    entryCount = section.split('\n').filter((line) => /^[-*] \S/.test(line)).length;
    assert.ok(entryCount > 0,
        `CHANGELOG.md's "## [${rootVersion}]" section carries no entries. A heading with nothing under it `
        + 'is the shape of a release record without its substance: it satisfies the check above, and tells '
        + 'a reader installing this version nothing about what changed. Write one short sentence per change '
        + `under a "### Fixed" / "### Added" / "### Changed" subsection (\`git log --oneline v<previous>..HEAD\` `
        + 'is the raw material), or run tools/release/bump-version.mjs, which promotes them from Unreleased.');
}

console.log(`OK: version-lockstep smoke (${members.length} packages + the store-facing`
    + `manifest.json + the user-facing buildInfo.js + README's badge and Status line all at ${rootVersion}`
    + `${isPrerelease ? '; prerelease, so no CHANGELOG section is required' : `, with a CHANGELOG section carrying ${entryCount} entries`}`
    + '; test/e2e exempt and documented)');
