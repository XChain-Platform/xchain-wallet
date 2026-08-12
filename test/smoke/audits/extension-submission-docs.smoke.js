// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the Chrome Web Store submission documents cite real
// files.
//
// The submission runbook is a ceremony document, 8 phases of ordered steps
// with irreversible ones called out (group-publisher conversion, the
// extension ID assigned at first upload and fixed forever). Its steps name
// documents and files the operator is told to read. Those citations were
// checked by hand once, when the runbook was written at stage S8.
//
// Nothing keeps them true. A rename in tools/release/ or a doc move sends
// the operator to a command that does not exist, mid-ceremony, on a review
// clock, in a procedure where some steps cannot be taken back. That is a
// bad place to discover a stale path, and it is a completely mechanical
// thing to check.
//
// a later change MOVED THESE DOCUMENTS OUT OF THIS REPO, into the sibling
// xchain-documentation checkout, and the port rewrote most of their
// repo-relative citations into relative Markdown links between documents.
// So this checks BOTH shapes, against whichever repo owns the target:
//
//   - a repo path (`tools/...`, `packages/...`) resolves in THIS repo;
//   - a relative `.md` link resolves inside the DOCS repo.
//
// The port also dropped the runbook's one deliberate cross-repo citation
// (the xchain-websites privacy-policy sync test), which is why this file no
// longer carries an exception list.
//
// The paths are extracted from the documents rather than listed here. A
// list would be another copy to maintain, and it would pass while the
// documents drifted around it.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

skipUnlessDocs('extension submission-docs smoke');

// The ceremony documents now live in the docs repo; the publish log is an
// operational record and stayed here, beside the artifact it describes.
const DOCS = [
    docsPath('release', 'extension', 'chrome-web-store.md'),
    docsPath('privacy', 'data-disclosure.md'),
    join(root, 'packages', 'extension', 'docs', 'publish-log.md'),
];

// Repo-relative paths only: a citation is a path if it starts at one of the
// repo's own top-level directories. Bare filenames and URLs are left alone.
const PATHISH = /(?:^|[\s`("[])((?:tools|packages|docs|test|scripts|\.github)\/[A-Za-z0-9._*/{}-]+)/g;

// Relative Markdown links between documents, the shape the port produced.
const DOCLINK = /\]\(((?:\.\.\/|\.\/)?[A-Za-z0-9._/-]+\.md)(?:#[^)]*)?\)/g;

// A citation carrying a version placeholder describes an artifact that does
// not exist until a release builds it (xchain-wallet-extension-vX.Y.Z.zip).
const isPlaceholder = (p) => /X\.Y\.Z|\{|\*/.test(p);

let checked = 0;
const missing = [];

for (const doc of DOCS) {
    assert.ok(existsSync(doc), `${doc} exists`);

    // Comments are maintainer notes; a path cited only in one is not a step
    // an operator is sent to follow. (This also drops the port-provenance
    // header, which names the pre-move path on purpose.)
    const text = readFileSync(doc, 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');

    for (const m of text.matchAll(PATHISH)) {
        const cited = m[1].replace(/[.,;:)\]]+$/, '');
        if (isPlaceholder(cited)) continue;
        checked += 1;
        if (!existsSync(join(root, cited))) missing.push(`${doc} cites ${cited}`);
    }

    // A relative doc link resolves against the citing document's own
    // directory, in whichever repo that document lives in.
    for (const m of text.matchAll(DOCLINK)) {
        const target = resolve(dirname(doc), m[1]);
        checked += 1;
        if (!existsSync(target)) missing.push(`${doc} links ${m[1]}`);
    }
}

// Floor FIRST: if the extraction silently stopped matching, the check below
// passes on an empty set and this file becomes decoration. It is asserted
// ahead of it so a broken extraction is reported as itself rather than as
// whichever downstream check happens to notice the fallout.
//
// The floor is 6, not the pre-move 20: the port rewrote most repo paths in
// these documents into prose, and what remains is the cross-document links
// plus the publish log's tool references. Raise it again if the documents
// grow their citations back.
assert.ok(checked >= 6,
    `only ${checked} citations were extracted from ${DOCS.length} submission documents; expected at `
    + 'least 6. The extraction regexes stopped matching, and the check below is now vacuous.');

assert.deepEqual(missing, [],
    'a submission document cites a file that does not exist. The submission runbook is an ordered '
    + 'ceremony with irreversible steps in it; a stale path is found by the operator mid-submission, on '
    + 'a review clock. Fix the citation or restore the file.');

console.log(`OK: extension submission-docs smoke (${checked} citations across`
    + `${DOCS.length} documents all resolve)`);
