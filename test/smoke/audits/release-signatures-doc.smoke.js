// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Where the About panel sends a user who taps "GPG fingerprint".
//
// RELEASE_SIGNATURES_DOC named `packages/extension/RELEASE_SIGNATURES.md`
// until 2026-08-16, months after the docs migration deleted that file. The
// pointer survived because RELEASE_SIGNATURES_PUBLISHED is false and the row
// renders "not yet published" instead of a link, so no test and no user ever
// followed it.
//
// The unit test (test/unit/aboutReleaseSignatures.test.jsx) renders the row
// with the flag forced true and proves it is a real anchor. This smoke is the
// other half: it proves the anchor's destination is the place the project
// actually publishes the fingerprint, which is a fact that lives in two other
// repositories and can therefore move without this one noticing.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsAvailable, docsPath } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const buildInfoSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'buildInfo.js'),
    'utf8',
);

const match = /export const RELEASE_SIGNATURES_DOC = '([^']+)';/.exec(buildInfoSrc);
assert.ok(match, 'buildInfo exports RELEASE_SIGNATURES_DOC as a string literal');
const docTarget = match[1];

// ─── 1. It is a destination, not a path ─────────────────────────────

// DocLink only renders an anchor for an absolute URL. A repo-relative value
// renders as inert text in the muted style, so it would not even 404: the
// user would be shown a path and left to find it themselves.
let parsed;
assert.doesNotThrow(
    () => { parsed = new URL(docTarget); },
    `RELEASE_SIGNATURES_DOC parses as an absolute URL (got ${JSON.stringify(docTarget)})`,
);
assert.equal(parsed.protocol, 'https:', 'RELEASE_SIGNATURES_DOC is served over https');

// The specific shape of the old defect, named so a revert reads as itself.
assert.ok(
    !/RELEASE_SIGNATURES\.md/.test(docTarget),
    'RELEASE_SIGNATURES_DOC does not name the file the docs migration deleted',
);
assert.ok(
    !existsSync(join(wsRoot, 'packages', 'extension', 'RELEASE_SIGNATURES.md')),
    'packages/extension/RELEASE_SIGNATURES.md is still gone (if it came back, '
    + 'decide which copy is canonical rather than having two)',
);

// ─── 2. It is where the fingerprint is actually published ───────────

// The fingerprint is deliberately published in ONE place, and the docs say
// which: a second copy of a trust root is a second thing to keep in step, and
// a stale copy is worse than none. So the doc's answer is the authority here,
// and this repo's constant has to agree with it. If the publication channel
// moves, this goes red in the repo that links to it.
if (docsAvailable()) {
    const verifyDoc = docsPath('release', 'verify-release.md');
    assert.ok(existsSync(verifyDoc), `${verifyDoc} exists`);
    const verifySrc = readFileSync(verifyDoc, 'utf8');
    assert.ok(
        verifySrc.includes('Where the release key fingerprint is published'),
        'verify-release.md still carries the fingerprint-publication section',
    );
    assert.ok(
        verifySrc.includes(docTarget),
        `verify-release.md names ${docTarget} as a fingerprint publication channel; `
        + 'the About panel must send users to the same page the docs do',
    );
}

// ─── 3. The page exists in the site that serves it ──────────────────

// xchain-websites is not a declared CI sibling, so this half is advisory:
// present locally it catches a link to a page nobody built, absent it says so
// rather than pretending it checked.
const sitesRoot = process.env.XCHAIN_WEBSITES_ROOT
    || join(wsRoot, '..', 'xchain-websites');
const pagePath = join(sitesRoot, parsed.hostname, parsed.pathname.replace(/^\/|\/$/g, ''), 'index.html');

if (existsSync(sitesRoot)) {
    assert.ok(
        existsSync(pagePath),
        `${docTarget} is built at ${pagePath}; the About panel links to a page that has to exist`,
    );
    const pageSrc = readFileSync(pagePath, 'utf8');
    assert.match(
        pageSrc,
        /fingerprint/i,
        'the linked page is the one that publishes a key fingerprint',
    );
} else {
    console.log(`NOTE: ${sitesRoot} is not in this checkout, so the existence of `
        + `${docTarget} was not verified here. Set XCHAIN_WEBSITES_ROOT to check it.`);
}

console.log('release-signatures-doc smoke OK');
