// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : every package ships at the root's version.
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
// version identifies nothing. That is a decision (, 2026-08-01), so
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

console.log(`OK: version-lockstep smoke (: ${members.length} packages + the store-facing `
    + `manifest.json + the user-facing buildInfo.js all at ${rootVersion}; test/e2e exempt and documented)`);
