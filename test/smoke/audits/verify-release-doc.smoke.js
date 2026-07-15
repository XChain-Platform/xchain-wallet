// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / G016: `docs/VERIFY-RELEASE.md`.
//
// Pins the doc's required structure: imports the maintainer's release
// key, downloads + signature-verifies the hash manifest, hash-checks
// the artifact, optionally reproduces the build. Every cross-link
// target either exists today or is explicitly tracked as a gap.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const docPath = 'docs/Verify_Release.md';
assert.ok(existsSync(join(root, docPath)), `${docPath} exists`);

const docSrc = read(docPath);

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

// Required cross-link targets exist OR are explicitly tracked gaps.
const crossLinks = [
    'docs/Reproducible_Builds.md',
    'SECURITY.md',
    'docs/QA_Checklist.md',
    // All-caps to match the actual file; a case-sensitive host (or linux CI)
    // 404s the mixed-case form, which the case-insensitive Mac FS hid.
    'packages/desktop/REPRODUCIBLE_BUILDS.md',
];
for (const linkPath of crossLinks) {
    assert.ok(docSrc.includes(linkPath),
        `verify-release doc references ${linkPath}`);
    assert.ok(existsSync(join(root, linkPath)),
        `cross-link target exists: ${linkPath}`);
}

// Spec citation present.
assert.ok(/§51/.test(docSrc) && /XCHAIN_WALLET_SPEC\.md/.test(docSrc),
    'verify-release doc cites §51 of XCHAIN_WALLET_SPEC.md');

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

console.log('OK: VERIFY-RELEASE.md doc smoke');
