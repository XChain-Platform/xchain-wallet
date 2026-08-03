// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  stage S15: the Chrome Web Store data-disclosure answers
// are derived from the code, and the three store forms cannot disagree.
//
// The Privacy practices tab is the most rejection-prone form in the
// submission ceremony (spec §3.3 names a policy/disclosure mismatch as the
// rejection cause), and until 2026-08-02 it was the only console field with
// no paste-ready source: the runbook told the operator to tick boxes to
// match a five-shell prose policy that enumerates none.
//
// Three things are checked here, and they are three different failure modes.
//
// 1. The data-disclosure host table is the extension shell of
//    `wireAudit.js`, both directions. A host that starts egressing and is
//    not disclosed is a removal class after approval; a host disclosed that
//    the extension does not contact describes an extension the reviewer
//    cannot observe, which is the same error pointing the other way.
//
// 2. The three store forms (Chrome, Play, Apple) must agree about whether
//    the wallet collects data at all. That binary was blocked on
//    for both mobile forms while nobody had noticed it blocks the Chrome one
//    too: the decision was called D8 in the iOS file, D9 in the Play file,
//    and  in the ledger, so there was no shared token to notice it
//    by.  is now SETTLED and all three answer "not collected"; the
//    rule stayed symmetric, so all three must still give the SAME answer.
//    Flipping it edits three files in one pass.
//
//     moved all three forms into the sibling xchain-documentation
//    checkout, and the port dropped the literal ": SETTLED" state
//    token in favour of prose, so the agreement is now read off the answer
//    each form actually gives. The gate skips, loudly, without the sibling.
//
// 3. `wireAudit.js` rows state `carries` and `control` per shell on a row
//    that does not repeat itself per shell. The five block-explorer icon
//    rows were written when their `shells` was `[]` and kept saying
//    "nothing on this shell" and "the CSP img-src admits no remote origin"
//    after they became `['extension']` - the exact opposite of the truth
//    about the one shell they claim, and about the single egress class the
//    privacy policy singles out as having no user control at all. Nothing
//    read those two fields, so nothing caught it. This does.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WIRE_AUDIT, egressHostsFor } from '../../../packages/core/src/privacy/wireAudit.js';
import { docsPath, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

skipUnlessDocs('extension data-disclosure smoke');

const DISCLOSURE = 'components/wallet/privacy/data-disclosure.md';
const RECORD = 'components/wallet/privacy/data-collection.md';
const MANIFEST = 'packages/extension/manifest.json';

// The three store forms that answer the same facts in three vocabularies.
const STORE_FORMS = [
    { label: DISCLOSURE, path: docsPath('privacy', 'data-disclosure.md') },
    { label: 'components/wallet/privacy/data-safety.md', path: docsPath('privacy', 'data-safety.md') },
    {
        label: 'components/wallet/privacy/privacy-nutrition-labels.md',
        path: docsPath('privacy', 'privacy-nutrition-labels.md'),
    },
];

assert.ok(existsSync(join(root, MANIFEST)), `${MANIFEST} exists`);

const doc = readFileSync(docsPath('privacy', 'data-disclosure.md'), 'utf8');
const manifest = JSON.parse(read(MANIFEST));

// ---------------------------------------------------------------------------
// 1. A wire-audit row may not describe a shell it does not apply to
// ---------------------------------------------------------------------------

// Checked FIRST, ahead of everything derived from it. `carries` and `control`
// are per-shell statements on a row that lists its shells separately, so
// editing `shells` without re-reading them corrupts the source, and the doc
// comparisons below would then report the DOCUMENT as wrong when the code is.
// Found by mutation: reverting these fields tripped the §3 control check
// first, which is true but is not the diagnosis.
const contradictions = [];
for (const entry of WIRE_AUDIT) {
    if (entry.shells.length === 0) continue;
    if (/^nothing\b/i.test(entry.carries)) {
        contradictions.push(`${entry.host}: egresses on ${entry.shells.join(', ')} but carries "${entry.carries}"`);
    }
    if (/img-src admits no remote origin|CSP.*\bblocks?\b/i.test(entry.control)) {
        contradictions.push(`${entry.host}: egresses on ${entry.shells.join(', ')} but control claims "${entry.control}"`);
    }
}

assert.deepEqual(contradictions, [],
    'a wireAudit.js row egresses on at least one shell while saying it carries nothing, or that a CSP '
    + 'structurally prevents it. Those two fields describe the shells in `shells`; when you edit `shells`, '
    + 're-read them in the same breath. Five block-explorer rows carried the wrong text this way from the '
    + 'day their shells changed until 2026-08-02, and the text said the opposite of the truth about the '
    + 'one egress class with no user control at all.');

// ---------------------------------------------------------------------------
// 2. The §3 host table is the extension shell of the wire audit
// ---------------------------------------------------------------------------

// Scoped to the section, not the whole file: the prose after the table names
// `downloads.xchain.io` and `connect.trezor.io` precisely in order to say the
// extension does NOT contact them, and a whole-file scan would read those as
// claims. Section-scoping is what lets the document explain an absence.
const sectionOf = (text, heading) => {
    const start = text.indexOf(heading);
    assert.notEqual(start, -1, `${DISCLOSURE} has a "${heading}" section`);
    const rest = text.slice(start + heading.length);
    const end = rest.search(/\n## /);
    return end === -1 ? rest : rest.slice(0, end);
};

const egressSection = sectionOf(doc, '## What the extension sends off the device');

// Table rows only. A row is a pipe line whose first cell names a host: either
// backticked, or the wildcard entry written as prose ("a host the token issuer
// chose"), which wireAudit records as `*`. The header and the `|---|`
// separator name neither.
//
// One cell may name SEVERAL hosts: the five block-explorer icon hosts share a
// row, since they share every other cell. Each is its own disclosure.
const WILDCARD_PROSE = /^(?:\*\*)?a host /i;
const rows = egressSection
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => cells.length >= 5
        && (/`[^`]+`/.test(cells[0]) || WILDCARD_PROSE.test(cells[0])));

const hostsOf = (cell) => {
    const ticked = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (ticked.length > 0) return ticked;
    return ['*'];
};

// One entry per (host, row), so a multi-host row is checked host by host.
const entries = rows.flatMap((cells) => hostsOf(cells[0]).map((host) => ({ host, cells })));
const documented = [...new Set(entries.map((e) => e.host))].sort();
const actual = egressHostsFor('extension');

// Floor first: if the row extraction silently stopped matching, every check
// below passes on an empty set and this file becomes decoration.
assert.ok(entries.length >= 10,
    `only ${entries.length} host disclosures were extracted from ${DISCLOSURE}; expected at least 10. `
    + 'The table shape changed and every check below is now vacuous.');

assert.deepEqual(documented, actual,
    `${DISCLOSURE} §3 does not match egressHostsFor('extension') in packages/core/src/privacy/wireAudit.js.\n`
    + `  documented: ${documented.join(', ')}\n`
    + `  actual:     ${actual.join(', ')}\n`
    + 'A host the extension contacts and this form does not disclose is a removal class after approval. '
    + 'A host disclosed here that the extension never contacts describes an extension the reviewer cannot '
    + 'observe. Fix wireAudit.js first if the code changed, then this table, then the Play and Apple forms.');

// Desktop-only egress must not be claimed. Named explicitly rather than left
// to the set comparison, because this is the specific mistake the Play form
// already made once and had to correct ().
assert.ok(!documented.includes('downloads.xchain.io'),
    `${DISCLOSURE} §3 claims downloads.xchain.io. That is the desktop update feed; the extension updates `
    + 'through the browser store and never requests it.');
assert.ok(/downloads\.xchain\.io\W+(?:is deliberately absent|is not contacted)/.test(doc),
    `${DISCLOSURE} must say why downloads.xchain.io is absent from the egress table, so the next reader `
    + 'can tell a deliberate omission from a forgotten host.');

// Party and "no user control" are derived per host, because those two cells
// are what a reviewer cross-checks against observed traffic. The `*` rows are
// presence-only: two wire-audit entries share the host `*` (the token-issuer
// host and the user-supplied restore link) with different controls, so a
// lookup keyed by host cannot tell them apart.
const byHost = new Map(WIRE_AUDIT.filter((e) => e.host !== '*').map((e) => [e.host, e]));
const partyMismatch = [];
const controlMismatch = [];
for (const { host, cells } of entries) {
    const entry = byHost.get(host);
    if (!entry) continue;
    if (!new RegExp(`\\b${entry.party}\\b`).test(cells[1])) {
        partyMismatch.push(`${host}: table says "${cells[1]}", wireAudit says "${entry.party}"`);
    }
    const uncontrolled = /^none\b/i.test(entry.control);
    const saysNone = /\bnone\b/i.test(cells[4]);
    if (uncontrolled !== saysNone) {
        controlMismatch.push(`${host}: table says "${cells[4]}", wireAudit control is "${entry.control}"`);
    }
}

assert.deepEqual(partyMismatch, [],
    `${DISCLOSURE} §3 disagrees with wireAudit.js about who operates a host. First-party and third-party `
    + 'are answered differently on every store form.');

assert.deepEqual(controlMismatch, [],
    `${DISCLOSURE} §3 disagrees with wireAudit.js about whether the user can stop a request. The egress `
    + 'with NO user control is the one the privacy policy singles out; claiming a toggle that does not '
    + 'exist is worse on this form than disclosing that there is none.');

// ---------------------------------------------------------------------------
// 2. The three store forms agree about the blocked collection binary
// ---------------------------------------------------------------------------

// Each form must state the ANSWER, not merely mention the decision. Keying
// on a bare id read agreement where it should read a state, so each form is
// classified by what it actually tells its store: NOT-COLLECTED, COLLECTED,
// or nothing (which is its own failure).
const NOT_COLLECTED = /does not collect user data|Data Not Collected|not collected|collect or share any of the required user data types\? \| \*\*No\*\*/i;
const COLLECTED = /\bdoes collect user data\b|collect or share any of the required user data types\? \| \*\*Yes\*\*/i;

const states = STORE_FORMS.map(({ label, path }) => {
    assert.ok(existsSync(path), `${label} exists (the three store forms answer one set of facts)`);
    const text = readFileSync(path, 'utf8');
    let state = null;
    if (COLLECTED.test(text)) state = 'COLLECTED';
    else if (NOT_COLLECTED.test(text)) state = 'NOT-COLLECTED';
    return { path: label, state };
});

const undeclared = states.filter((f) => !f.state).map((f) => f.path);
assert.deepEqual(undeclared, [],
    `${undeclared.join(', ')} does not state an answer to the collection question. Every store form must `
    + 'say plainly whether the wallet collects user data, so the three can be compared mechanically '
    + 'rather than by reading three documents in three vocabularies.');

const distinct = [...new Set(states.map((f) => f.state))];
assert.equal(distinct.length, 1,
    'the store forms disagree about whether the wallet collects user data.\n'
    + states.map((f) => `  ${(f.state || '(none)').padEnd(13)} ${f.path}`).join('\n')
    + '\nThree stores cannot be told two different things about one binary. Whichever way the answer goes, '
    + 'all three forms change in the same pass.');

// ---------------------------------------------------------------------------
// 3. The manifest claims this form makes
// ---------------------------------------------------------------------------

// The strongest "No" on the form is web browsing activity, and it rests on
// permissions that are absent rather than on anything present. An absence is
// exactly what nobody notices becoming a presence.
const MUST_NOT_DECLARE = ['tabs', 'webNavigation', 'history', 'webRequest', 'webRequestBlocking', 'browsingData'];
const declared = new Set(manifest.permissions || []);
const forbidden = MUST_NOT_DECLARE.filter((p) => declared.has(p));

assert.deepEqual(forbidden, [],
    `packages/extension/manifest.json declares ${forbidden.join(', ')}, and ${DISCLOSURE} §5 answers "No" `
    + 'to web browsing activity on the grounds that no such permission exists. Either the permission goes, '
    + 'or the form answer changes and the Limited Use posture changes with it.');

// The doc has to name the permission CLASSES the "No" rests on, so the
// claim cannot quietly shrink to whichever permissions happen to be absent
// today. The port reworded the individual backticked permission names into
// classes ("no tab, navigation, history or web-request permission is
// declared"), so the classes are what is pinned.
const CLAIM_CLASSES = [/\btab\b/i, /\bnavigation\b/i, /\bhistory\b/i, /web-request|webRequest/i];
const namedInDoc = CLAIM_CLASSES.filter((re) => re.test(doc));
assert.equal(namedInDoc.length, CLAIM_CLASSES.length,
    `${DISCLOSURE} names only ${namedInDoc.length} of the ${CLAIM_CLASSES.length} browsing-activity `
    + 'permission classes its "No" rests on. The claim is only as strong as the list it names.');

assert.ok(Array.isArray(manifest.host_permissions) && manifest.host_permissions.length === 0,
    `packages/extension/manifest.json now declares host_permissions (${JSON.stringify(manifest.host_permissions)}), `
    + `and ${DISCLOSURE} §5 answers the browsing-activity question by saying it is empty. Flip this check `
    + 'rather than deleting it: a host permission changes the answer on this form, triggers CWS re-review, '
    + 'and can disable the extension for installed users until they re-accept.');

// ---------------------------------------------------------------------------
// 4. The declaration of record describes the manifest it is transcribed from
// ---------------------------------------------------------------------------

// The declaration of record said "matches all http/https pages" for two days
// after D6 narrowed the content script, in the document every store form is
// transcribed from. Derived rather than restated now.
const record = readFileSync(docsPath('privacy', 'data-collection.md'), 'utf8');
const csClaim = record.match(/A content script matches([\s\S]*?)to inject/);
assert.ok(csClaim, `${RECORD} has a content-script scope sentence for the extension`);
const claimedMatches = [...csClaim[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
const manifestMatches = [...new Set(manifest.content_scripts.flatMap((c) => c.matches))].sort();

assert.deepEqual(claimedMatches, manifestMatches,
    `${RECORD} describes a content-script scope the manifest does not have.\n`
    + `  claimed:  ${claimedMatches.join(', ') || '(none)'}\n`
    + `  manifest: ${manifestMatches.join(', ')}\n`
    + 'This is the document all three store forms are transcribed from, and content-script scope is a '
    + 'question every one of them asks.');

console.log(`OK: extension data-disclosure smoke ( S15: ${documented.length} extension egress hosts `
    + `derived from wireAudit.js, ${STORE_FORMS.length} store forms agreeing on the collection binary, `
    + `content-script scope matching the manifest)`);
