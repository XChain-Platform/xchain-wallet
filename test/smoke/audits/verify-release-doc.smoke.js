// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / G016: the release-verification recipe.
//
//  moved it to the sibling xchain-documentation checkout
// (components/wallet/release/verify-release.md), published at
// https://docs.xchain.io/components/wallet/release/verify-release. It
// documents commands run against THIS repo, so the assertions followed
// it across; the gate skips, loudly, without that checkout.
//
// Pins the doc's required structure: imports the maintainer's release
// key, downloads + signature-verifies the hash manifest, hash-checks
// the artifact, optionally reproduces the build. Every cross-link
// target either exists today or is explicitly tracked as a gap.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

skipUnlessDocs('verify-release-doc smoke');

const docPath = docsPath('release', 'verify-release.md');
assert.ok(existsSync(docPath), `${docPath} exists`);

const docSrc = readFileSync(docPath, 'utf8');

// Required headings (the procedure has to be skimmable).
const requiredHeadings = [
    '# Verify a release',
    '## What you\'re checking',
    '## Prerequisites',
    '## Step 1',
    '## Step 2',
    '## Step 3',
    '## Step 4',
    '## Step 5 (optional but recommended)',
    '## What "verified" means and does not mean',
    '## Reporting a verification failure',
];
for (const heading of requiredHeadings) {
    assert.ok(docSrc.includes(heading), `verify-release doc has heading: ${heading}`);
}

// Three independent claims (reproducibility / hash / signature) named
// up front so a reader cannot skim and miss one.
for (const claim of ['reproducibility', 'integrity', 'authenticity']) {
    assert.ok(new RegExp(`\\*\\*${claim[0].toUpperCase() + claim.slice(1)}`, 'i').test(docSrc)
        || new RegExp(`\\b${claim}\\b`, 'i').test(docSrc),
        `doc names the "${claim}" claim`);
}

// Concrete commands the user runs.
const commands = [
    'gpg --keyserver',
    'gpg --verify RELEASE_HASHES.txt.asc RELEASE_HASHES.txt',
    'sha256sum -c',
    'bash packages/desktop/scripts/reproduce.sh',
];
for (const cmd of commands) {
    assert.ok(docSrc.includes(cmd),
        `verify-release doc includes shell command: ${cmd}`);
}

// Required cross-links resolve. They are relative links inside the docs
// repo now, so the link and its target are checked in the same place. The
// per-shell desktop recipe is a section of reproducible-builds.md rather
// than its own file, and the security policy is the docs repo's security.md
// rather than this repo's SECURITY.md.
const crossLinks = [
    ['../reproducible-builds.md', docsPath('reproducible-builds.md')],
    ['../security.md', docsPath('security.md')],
    ['qa-checklist.md', docsPath('release', 'qa-checklist.md')],
    ['desktop/linux.md', docsPath('release', 'desktop', 'linux.md')],
];
for (const [link, target] of crossLinks) {
    assert.ok(docSrc.includes(`(${link})`),
        `verify-release doc references ${link}`);
    assert.ok(existsSync(target),
        `cross-link target exists: ${link}`);
}

// The spec citation was a pointer into the platform's private planning
// tree, which a published page cannot send a reader to. Dropped rather than
// reworded: there is no public §51 to cite.

// Failure-mode guidance: if a signature or hash check fails the user
// should know to STOP and not run the artifact.
assert.ok(/[sS]top/.test(docSrc) && /[Dd]o not run/.test(docSrc),
    'doc warns the user to stop on verification failure');

// Honest framing of what verification does NOT mean.
for (const limit of [
    /bug-free/,
    /key has not been compromised/,
    /Upstream dependencies are safe/,
]) {
    assert.ok(limit.test(docSrc),
        `doc honestly bounds verification scope: ${limit}`);
}

console.log('OK: verify-release doc smoke');
