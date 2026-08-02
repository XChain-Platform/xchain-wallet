// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the Chrome Web Store submission documents cite real
// files.
//
// SUBMISSION-RUNBOOK.md is a ceremony document, 8 phases of ordered steps
// with irreversible ones called out (group-publisher conversion, the
// extension ID assigned at first upload and fixed forever). Its steps name
// scripts and files the operator is told to run and read. Those citations
// were checked by hand once, when the runbook was written at stage S8.
//
// Nothing keeps them true. A rename in tools/release/ or a doc move sends
// the operator to a command that does not exist, mid-ceremony, on a review
// clock, in a procedure where some steps cannot be taken back. That is a
// bad place to discover a stale path, and it is a completely mechanical
// thing to check.
//
// The paths are extracted from the documents rather than listed here. A
// list would be a fourth copy to maintain, and it would pass while the
// documents drifted around it.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const DOCS = [
    'packages/extension/docs/SUBMISSION-RUNBOOK.md',
    'packages/extension/docs/STORE_LISTING_PACK.md',
    'packages/extension/docs/publish-log.md',
    'packages/extension/docs/store-correspondence.md',
];

// Repo-relative paths only: a citation is a path if it starts at one of the
// repo's own top-level directories. Bare filenames and URLs are left alone.
const PATHISH = /(?:^|[\s`("[])((?:tools|packages|docs|test|scripts|\.github)\/[A-Za-z0-9._*/{}-]+)/g;

// Cited on purpose, and correctly, but not resolvable here. Each entry
// states why, so the next person can tell a deliberate exception from a
// forgotten one.
const NOT_IN_THIS_REPO = new Map([
    ['test/wallet-privacy-policy-sync.test.js',
        'lives in the xchain-websites repo; the runbook names it so the operator checks the hosted page '
        + 'from both ends, and says in the same breath that it does not own that repo'],
]);

// A citation carrying a version placeholder describes an artifact that does
// not exist until a release builds it (xchain-wallet-extension-vX.Y.Z.zip).
const isPlaceholder = (p) => /X\.Y\.Z|\{|\*/.test(p);

let checked = 0;
const missing = [];
const staleExceptions = [];

for (const doc of DOCS) {
    const full = join(root, doc);
    assert.ok(existsSync(full), `${doc} exists`);

    // Comments are maintainer notes; a path cited only in one is not a step
    // an operator is sent to follow.
    const text = readFileSync(full, 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');

    for (const m of text.matchAll(PATHISH)) {
        const cited = m[1].replace(/[.,;:)\]]+$/, '');
        if (isPlaceholder(cited)) continue;
        if (NOT_IN_THIS_REPO.has(cited)) continue;
        checked += 1;
        if (!existsSync(join(root, cited))) missing.push(`${doc} cites ${cited}`);
    }
}

// If an exception stops being needed (the file arrives, or the citation is
// dropped), say so rather than carrying a dead entry that quietly excuses a
// path nobody cites any more.
for (const [path, why] of NOT_IN_THIS_REPO) {
    const citedSomewhere = DOCS.some((d) => readFileSync(join(root, d), 'utf8').includes(path));
    if (!citedSomewhere) staleExceptions.push(`${path} (${why})`);
    else if (existsSync(join(root, path))) staleExceptions.push(`${path} now exists in this repo (${why})`);
}

// Floor FIRST: if the extraction silently stopped matching, the checks
// below pass on an empty set and this file becomes decoration. It is
// asserted ahead of them so a broken extraction is reported as itself
// rather than as whichever downstream check happens to notice the fallout
// (found by mutation: redacting the path prefixes tripped the exception
// check first, which is true but is not the diagnosis).
assert.ok(checked >= 20,
    `only ${checked} path citations were extracted from ${DOCS.length} submission documents; expected at `
    + 'least 20. The extraction regex stopped matching, and every check below is now vacuous.');

assert.deepEqual(missing, [],
    'a submission document cites a file that does not exist. SUBMISSION-RUNBOOK.md is an ordered ceremony '
    + 'with irreversible steps in it; a stale path is found by the operator mid-submission, on a review '
    + 'clock. Fix the citation or restore the file.');

assert.deepEqual(staleExceptions, [],
    'the NOT_IN_THIS_REPO exception list in this smoke has an entry that is no longer needed. Remove it, '
    + 'so the list keeps meaning "deliberately elsewhere" rather than "excused once".');

console.log(`OK: extension submission-docs smoke (: ${checked} path citations across `
    + `${DOCS.length} documents all resolve, ${NOT_IN_THIS_REPO.size} deliberate cross-repo exception)`);
