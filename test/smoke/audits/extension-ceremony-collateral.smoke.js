// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Chrome submission ceremony is an OPERATIONAL checklist, and this holds
// it to the two things that make it one: the values it tells an operator to
// paste, and the fact that it is checkable at all.
//
// THE OPERATOR'S RULING, 2026-08-03: ceremonies ARE documentation, and
// documentation has ONE home, the xchain-documentation repo. This code repo
// carries a README plus conventional meta files and machine-consumed data
// (the listing assets, the manifest freeze, the publish log), and no prose.
// The previous same-day exemption, which had restored the runbook, the
// listing pack and the data disclosure into packages/extension/docs/, is
// overturned: those three files are deleted and the full ceremony, its
// checkable steps, its commands and the public identity values it tells an
// operator to transcribe, now lives in the two sibling docs pages.
//
// So this gate keeps its job and changes its subject. It no longer proves
// that a second copy exists here; it proves the ONE copy over there did not
// get de-operationalized. That is the failure this file was created for:
// 's port rendered the ceremony as evergreen public prose and, as
// measured at the time, the page carried 0 of the runbook's 40 checkable
// steps, 0 of its 8 fenced command blocks, and none of the public-identity
// values the trader declaration publishes. An operator cannot transcribe
// from a document that deduplicated the values away, and cannot follow a
// procedure with irreversible steps from prose with no steps in it.
//
// Nothing below duplicates a value: every expected value is READ from the
// declaration of record (privacy/trader-identity.md) or from the code.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { egressHostsFor } from '../../../packages/core/src/privacy/wireAudit.js';
import { docsPath, readDoc, skipUnlessDocs } from '../_docs-repo.js';

skipUnlessDocs('extension ceremony-collateral smoke');

// The two sibling pages that carry the ceremony, and the record they are
// held to. Named relative to the wallet docs root, the way the docs site
// publishes them.
const CEREMONY = ['release', 'extension', 'chrome-web-store.md'];
const DISCLOSURE = ['privacy', 'data-disclosure.md'];
const RECORD = ['privacy', 'trader-identity.md'];

for (const parts of [CEREMONY, DISCLOSURE, RECORD]) {
    assert.ok(existsSync(docsPath(...parts)),
        `${parts.join('/')} is missing from the docs repo. The Chrome submission ceremony lives there `
        + 'and only there (operator ruling 2026-08-03: documentation has one home). If it is being '
        + 'moved again, that is a decision to take deliberately, not a file to delete.');
}

const ceremony = readDoc(...CEREMONY);
const disclosure = readDoc(...DISCLOSURE);

// --- 1. The ceremony has to be executable ------------------------------
//
// The exact property that was lost in porting, and the one that would go
// again the next time someone renders this page as prose. These floors are
// the counts actually folded into the page on 2026-08-03 (50 checkable
// steps, 5 fenced blocks: 4 commands plus the trader block an operator
// transcribes). They are floors, not equalities, so the page may grow.
//
// A FUTURE SCRUB THAT DE-OPERATIONALIZES THIS PAGE MUST FAIL HERE. Turning
// steps back into paragraphs, or describing a command instead of giving it,
// is the regression this gate exists for. If the ceremony genuinely shrinks
// (a phase retired, a command replaced), lower the floor deliberately, in
// the same change, and say why.

const stepsIn = (text) => (text.match(/^[⬜✅]/gm) || []).length;
const fencesIn = (text) => (text.match(/^\s*```/gm) || []).length;

const steps = stepsIn(ceremony);
assert.ok(steps >= 50,
    `release/extension/chrome-web-store.md carries ${steps} checkable steps, below the 50 folded in on `
    + '2026-08-03. A submission ceremony with irreversible and ordering-sensitive actions is followed '
    + 'step by step or it is improvised; the scrubbed page had 0, which is what made this gate '
    + 'necessary. Checkable means a ⬜ or ✅ at line start, the repo convention, not a GFM checkbox.');

const commandBlocks = fencesIn(ceremony) / 2;
assert.ok(commandBlocks >= 5,
    `release/extension/chrome-web-store.md carries ${commandBlocks} fenced blocks, below the 5 folded in `
    + 'on 2026-08-03. The operator verifies an artifact hash and a privacy URL from this page and '
    + 'transcribes the trader block out of it; prose describing a command is not a command.');

const disclosureSteps = stepsIn(disclosure);
assert.ok(disclosureSteps >= 9,
    `privacy/data-disclosure.md carries ${disclosureSteps} checkable steps, below the 9 folded in on `
    + '2026-08-03. Its "Before you tick anything" block is the last thing standing between a stale '
    + 'measurement and a permanent answer on a store form.');

// --- 2. The identity values, read from the record and never restated ----

const recordRaw = readDoc(...RECORD);
const record = {};
for (const m of recordRaw.matchAll(/^\|\s*([A-Za-z ]+?)\s*\|\s*`?([^|`]+?)`?\s*\|\s*$/gm)) {
    const field = m[1].trim().toLowerCase();
    if (field === 'field') continue;
    record[field] = m[2].trim();
}

const PUBLISHED = ['entity', 'street', 'email', 'phone'];
for (const field of PUBLISHED) {
    assert.ok(record[field],
        `the declaration of record does not define "${field}", so this gate cannot verify what the `
        + 'ceremony tells an operator to publish. Fix the record first: it is the source.');
}

// The ceremony must CARRY the published contact set, because its whole job is
// to be transcribed. Absence is the failure being guarded, so presence is
// asserted rather than merely "no contradiction". These four values are
// public by definition: they appear on the store listing itself.
for (const field of PUBLISHED) {
    assert.ok(ceremony.includes(record[field]),
        `release/extension/chrome-web-store.md never names the ${field} "${record[field]}" that `
        + 'privacy/trader-identity.md declares. The EU DSA trader declaration is transcribed by hand '
        + 'into the console from this page; a value that is not on it is a value the operator either '
        + 'guesses or leaves blank, and it is published permanently and publicly.');
}

// And neither page may name a value the record has retired. Cross-page now,
// because both pages are translations of the same record.
const RETIRED = ['support@xchain.io'];
for (const [label, text] of [
    ['release/extension/chrome-web-store.md', ceremony],
    ['privacy/data-disclosure.md', disclosure],
]) {
    for (const retired of RETIRED) {
        assert.ok(!text.includes(retired),
            `${label} names the retired contact ${retired}. The declared address is "${record.email}". `
            + 'One legal entity showing two public contacts is the 2026-08-01 regression that made the '
            + 'declaration of record necessary in the first place.');
    }
}

// --- 3. The disclosure still derives from the code ---------------------

const extensionHosts = egressHostsFor('extension').filter((h) => h !== '*');

for (const host of extensionHosts) {
    assert.ok(disclosure.includes(host),
        `privacy/data-disclosure.md does not name ${host}, which wireAudit.js says the extension `
        + 'contacts. The data-disclosure tab is answered from that page, and an egress the console form '
        + 'does not declare is exactly the policy-versus-disclosure mismatch that gets a wallet listing '
        + 'rejected.');
}

// --- 4. Every WALLET-REPO path the ceremony cites has to resolve -------
//
// S12's finding, and moving the ceremony to the docs repo inverted it rather
// than retiring it: a rename in tools/release/ still sends the operator to a
// dead command mid-ceremony, on a review clock, in a procedure with
// irreversible steps. What changed is who can notice. The docs repo tests its
// own internal links (internal-link-integrity.test.js) and cannot see this
// tree at all; this gate is the only place that reads both, so the check
// belongs here and nowhere else.
//
// Deliberately one-directional: the ceremony page may cite a file without
// that file knowing about the ceremony, so a path with no citation is fine
// and only a citation with no path is a failure.

const CITED = /`((?:packages|tools|test|\.github)\/[A-Za-z0-9_./-]+)`/g;
const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = join(here, '..', '..', '..');
const missing = [];
let citations = 0;

for (const [label, text] of [
    ['release/extension/chrome-web-store.md', ceremony],
    ['privacy/data-disclosure.md', disclosure],
]) {
    for (const m of text.matchAll(CITED)) {
        const cited = m[1];
        if (/vX\.Y\.Z|<|\*/.test(cited)) continue;      // version placeholders are not paths
        citations += 1;
        if (!existsSync(join(walletRoot, cited))) missing.push(`${label} cites ${cited}`);
    }
}

assert.equal(missing.length, 0,
    `the Chrome ceremony cites wallet-repo paths that do not exist:\n  ${missing.join('\n  ')}\n`
    + 'An operator following the published page mid-submission meets a dead command. These pages live '
    + 'in xchain-documentation and the paths live here, so nothing on either side of that boundary '
    + 'resolves them except this gate.');

assert.ok(citations > 0,
    'no wallet-repo paths were found cited in the ceremony pages, so the citation check above passed '
    + 'without checking anything. The ceremony tells an operator to run commands out of this repo; if '
    + 'it stopped doing that, this gate needs rewriting rather than deleting.');

// --- 5. The private pointers the public page is forbidden to carry ------
//
// S23's finding. The docs standard bars claude/ paths, XC ids and store
// identities from published pages and names the  spec as their home
// instead. The migration stripped them out of the ceremony page correctly and
// nothing picked them up, so for a day the page told an operator to "log it in
// the correspondence log, in full, before responding" and no document anywhere
// said where that log was. A rejection clock can be seven days.
//
// Scoped hard to the spec's §4a block, and that scoping is the point: this
// spec is a history-bearing document that deliberately names files deleted
// long ago in its superseded rows, so a blanket every-path-resolves rule would
// fire on correct writing, and a check that fires on correct writing gets
// deleted (the S14 lesson). Only the block that claims to be a live map is
// held to being one.

const specPath = join(walletRoot, '..', 'claude', 'specs', 'wallet-publishing-chrome-extension.md');
let pointers = 0;

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const start = spec.indexOf('## 4a. The private pointers');
    assert.ok(start !== -1,
        'the  spec no longer has a "## 4a. The private pointers" block. That block is where the '
        + 'docs standard puts the operator map the published ceremony page is forbidden to carry: the '
        + 'correspondence log, the incident runbook, the K7 custody row. If it moved, repoint this '
        + 'gate in the same change; if it was deleted, the operator has no map on a rejection clock.');

    const end = spec.indexOf('\n## ', start + 1);
    const block = spec.slice(start, end === -1 ? undefined : end);
    const missing = [];

    for (const m of block.matchAll(/`(claude\/[A-Za-z0-9_./-]+)`/g)) {
        pointers += 1;
        if (!existsSync(join(walletRoot, '..', m[1]))) missing.push(m[1]);
    }

    assert.equal(missing.length, 0,
        `the  spec's §4a private-pointer map names paths that do not exist:\n  `
        + `${missing.join('\n  ')}\n`
        + 'This block exists because the published ceremony page cannot name these, so it is the only '
        + 'place an operator can find them. It named a correspondence log deleted three days earlier '
        + 'until 2026-08-03.');

    assert.ok(pointers >= 3,
        `§4a lists ${pointers} private pointers, fewer than the three it was written with (the `
        + 'correspondence log, the incident runbook, the K7 custody row). A map that loses an entry '
        + 'is how the migration lost them all in the first place.');
}

const pointerNote = existsSync(specPath)
    ? `${pointers} §4a private pointers resolved`
    : 'the §4a private-pointer map SKIPPED (platform checkout absent)';

console.log(`OK: extension ceremony-collateral smoke (operator ruling 2026-08-03, one home: `
    + `${steps} checkable steps + ${commandBlocks} fenced blocks on the ceremony page, `
    + `${disclosureSteps} on the disclosure, ${PUBLISHED.length} identity values traced to `
    + `privacy/trader-identity.md, ${extensionHosts.length} egress hosts from wireAudit.js, `
    + `${citations} cited wallet-repo paths resolved across the repo boundary, ${pointerNote})`);
