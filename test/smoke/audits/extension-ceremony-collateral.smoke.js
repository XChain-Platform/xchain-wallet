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
import { dirname, join, resolve } from 'node:path';
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

// --- 6. The frontier's LIVE rows have to name artifacts that exist ------
//
// S24's finding, and it is section 5's defect one level up. §4a is now held
// to being a live map; the frontier table above it is not, and it is the
// table an operator actually reads to learn what is left. It has rotted
// twice in two stages: S23 found row 3 naming docs/BRIDGE.md, deleted by
// , and S24 found ROW 1 - the row that IS the goal - still telling an
// operator to execute SUBMISSION-RUNBOOK.md, which the operator's own
// one-home ruling deleted at S22, out of this very gate's subject line.
//
// The scoping repeats section 5's lesson because this document earns it
// twice over: the spec deliberately names long-dead files in its superseded
// rows, so only rows that are still LIVE are held to naming live things. A
// row is live when its Item cell is neither struck through (~~...~~, this
// spec's mark for a closed row) nor a parenthesised superseded copy.

const frontierRows = [];
let goalRow = null;

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const fStart = spec.indexOf('<!-- BUILD-SPEC:FRONTIER');
    const fEnd = spec.indexOf('<!-- /BUILD-SPEC:FRONTIER', fStart + 1);
    assert.ok(fStart !== -1 && fEnd > fStart,
        'the  spec has no BUILD-SPEC:FRONTIER block. That block is the spec\'s own record of '
        + 'what is left and who owns each row; without it the goal state lives nowhere.');

    for (const line of spec.slice(fStart, fEnd).split('\n')) {
        if (!line.startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 5) continue;
        const [id, item, , state] = cells;
        if (!/^\d/.test(id)) continue;                       // header and separator
        if (item.startsWith('~~') || item.startsWith('(')) continue;   // closed / superseded copy
        if (/^(DONE|note)/i.test(state)) continue;
        // The Item cell is what the row is ABOUT - the thing it tells somebody
        // to go and do. The Evidence cell is where this spec keeps its record,
        // and that record legitimately names dead files in order to say they
        // died ("this row named SUBMISSION-RUNBOOK.md until S24"). Holding the
        // narrative to the subject's rule would fire on correct writing, which
        // is the S14 lesson and is exactly what the first cut of this check did.
        frontierRows.push({ id, line, item });
        if (id === '1') goalRow = item;
    }

    // 6a. The goal row names the ceremony that exists, not one of the four
    // wallet-repo documents the one-home ruling deleted. Derived from this
    // gate's own CEREMONY constant, so a future move repoints both together.
    assert.ok(goalRow,
        'the  frontier has no live row 1. Row 1 is the console ceremony, which IS the goal of '
        + 'this spec; if it closed, the goal is reached and the spec should say so.');

    const ceremonyDoc = CEREMONY[CEREMONY.length - 1];
    assert.ok(goalRow.includes(ceremonyDoc),
        `the  frontier's goal row does not name ${ceremonyDoc}, the document that actually `
        + 'carries the ceremony. This row is the one an operator reads to find out what to execute, '
        + 'and it pointed at the deleted wallet-repo runbook for two stages after the one-home ruling.');

    const DELETED_BY_RULING = ['SUBMISSION-RUNBOOK.md', 'STORE_LISTING_PACK.md',
        'DATA_DISCLOSURE.md', 'TEST_DAPP_RUNBOOK.md'];
    const revenants = frontierRows
        .filter(({ item }) => DELETED_BY_RULING.some((d) => item.includes(d)))
        .map(({ id }) => id);

    assert.equal(revenants.length, 0,
        `live frontier rows ${revenants.join(', ')} name wallet-repo ceremony documents that the `
        + 'operator\'s one-home ruling deleted on 2026-08-03. A superseded row may name them (that is '
        + 'the record); a row still telling somebody to go and do something may not.');

    // 6b. The phase range is READ from the ceremony page's own headings. A
    // phase added or retired there and not here under-executes the ceremony.
    const phases = [...ceremony.matchAll(/^#{2,4}\s+Phase\s+(\d+)/gm)].map((m) => Number(m[1]));
    assert.ok(phases.length > 0,
        'no "Phase N" headings were found on the ceremony page, so the phase-range check below passed '
        + 'without checking anything. The ceremony is phased on purpose: the ordering-sensitive and '
        + 'irreversible steps are what the phases separate.');

    const range = `Phases ${Math.min(...phases)}-${Math.max(...phases)}`;
    assert.ok(goalRow.includes(range),
        `the  frontier's goal row does not say "${range}", which is the phase range the ceremony `
        + `page actually carries (${phases.length} phase headings). It said "Phases 1-8" while the `
        + 'page began at Phase 0: Preconditions, so the row understated the ceremony by a whole phase.');

    // 6c. Anything a live row cites has to resolve, in whichever tree owns it.
    //
    // A packages//tools//test/ path is NOT necessarily this repo's: the release
    // story spans sibling checkouts, and test/wallet-privacy-policy-sync.test.js
    // lives in xchain-websites. Resolving against the wallet tree alone reports
    // a live file as dead, which is a check firing on correct writing, and this
    // was not a hypothetical - the S24 sweep that found this defect in the
    // sibling specs made exactly that mistake on three of its five hits.
    const SIBLINGS = [walletRoot, join(walletRoot, '..', 'xchain-websites')];
    const resolvesSomewhere = (p) => SIBLINGS.some((root) => existsSync(join(root, p)));

    const dead = [];
    for (const { id, line } of frontierRows) {
        for (const m of line.matchAll(CITED)) {
            if (/vX\.Y\.Z|<|\*/.test(m[1])) continue;
            if (!resolvesSomewhere(m[1])) dead.push(`row ${id} cites ${m[1]}`);
        }
        for (const m of line.matchAll(/`(claude\/[A-Za-z0-9_./-]+)`/g)) {
            if (!existsSync(join(walletRoot, '..', m[1]))) dead.push(`row ${id} cites ${m[1]}`);
        }
    }

    assert.equal(dead.length, 0,
        `live rows of the  frontier cite paths that do not exist:\n  ${dead.join('\n  ')}\n`
        + 'The frontier is what a later stage, or the operator, reads to find out what is left. A live '
        + 'row pointing at a deleted file is how two stages in a row lost the thing they were about.');
}

// --- 7. The pre-migration translation map has to translate --------------
//
//  moved this spec's documents out from under it, and rather than
// rewrite every citation in a history-bearing spec, §32 answers with a rule:
// "where a step still cites a pre-migration path, read it as the new home",
// followed by the map. That is a sound choice, and it makes the map the ONLY
// route a reader has to a live deliverable - which means the map going stale
// silently breaks every old citation at once.
//
// It had already lost two entries when this check was written, and they were
// the two it could least afford: docs/Data_Collection.md and
// docs/Trader_Identity.md, the declarations of record, cited ten times in
// this spec's live text with no map entry to resolve either.
//
// New homes are told from old names by the docs repo's own naming standard
// rather than by a hand-listed set: published pages are lowercase-kebab-case,
// and every pre-migration name carries an uppercase letter or an underscore
// (SUBMISSION-RUNBOOK.md, DATA_SAFETY.md, docs/Verify_Release.md). So the
// left-hand sides are deliberately NOT resolved - they are supposed to be
// dead - and only the right-hand sides are held to existing.

let mapEntries = 0;

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const start = spec.indexOf('**Reading older text in this spec**');
    assert.ok(start !== -1,
        'the  spec no longer has its "Reading older text in this spec" block. That block is the '
        + 'rule that lets the spec keep citing pre-migration paths without rewriting its own history; '
        + 'without it, every older citation in the file resolves to nothing.');

    const end = spec.indexOf('\n\n', start + 1);
    const block = spec.slice(start, end === -1 ? undefined : end);
    const unresolved = [];

    for (const m of block.matchAll(/`([a-z0-9][a-z0-9/-]*\.md)`/g)) {
        mapEntries += 1;
        if (!existsSync(docsPath(...m[1].split('/')))) unresolved.push(m[1]);
    }

    assert.equal(unresolved.length, 0,
        `the  spec's pre-migration translation map points at docs-repo pages that do not `
        + `exist:\n  ${unresolved.join('\n  ')}\n`
        + 'Every older citation in this spec resolves through this map and nowhere else, so a stale '
        + 'right-hand side breaks all of them at once and silently.');

    // The floor is 10, the count AFTER S24 restored the two declarations of
    // record. Setting it at the pre-S24 count of 8 would have left the exact
    // regression this section was written for able to walk straight back in.
    assert.ok(mapEntries >= 10,
        `the translation map lists ${mapEntries} new-home pages, fewer than the ten it carries. It had `
        + 'already lost the two declarations of record before anyone checked; a map that loses an '
        + 'entry is how the migration lost them all in the first place. If a page was genuinely '
        + 'retired, lower this floor deliberately in the same change and say why.');
}

// --- 8. A step that says "go edit that page" has to find it there -------
//
// Sections 4 and 6 resolve PATHS: they prove a cited file exists. This one
// is the layer they cannot see, and it was live when it was written.
//
// Phase 6 tells the operator to record the store-assigned extension ID into
// the bridge documentation "wherever it documents chrome-extension://<id>/...
// (currently a placeholder <id>)". Measured 2026-08-03: the page contained no
// occurrence of chrome-extension:// at all. 's port had genericized the
// sentence that carried it ("real windows owned by the wallet's own origin"),
// which reads perfectly well and quietly deleted the only thing the ceremony
// step was aiming at. Section 4 stayed green throughout, because the LINK was
// always fine; it was the destination's contents that had moved on.
//
// This is the worst step in the ceremony to leave pointing at nothing. It runs
// in the minutes after first upload, the ID is assigned exactly once and is
// permanent, and every earlier phase in this file exists to protect it.
//
// Scoped to CHECKABLE STEPS that both link a page and name a placeholder in
// backticks, on section 6's precedent: this ceremony narrates deleted things
// on purpose (Phase 3 discusses an old "placeholder document root" that must
// stay gone), and a check that fires on correct writing is one people delete.

const placeholderSteps = [];

for (const line of ceremony.split('\n')) {
    if (!/^[⬜✅]/.test(line) || !line.includes('placeholder')) continue;
    const link = line.match(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/);
    if (!link) continue;
    // A trailing ellipsis is prose ("chrome-extension://<id>/..."), not part
    // of the token the page is supposed to carry.
    const tokens = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\.{3}$/, ''));
    placeholderSteps.push({ target: link[1], tokens });
}

assert.ok(placeholderSteps.length >= 1,
    'no checkable step on release/extension/chrome-web-store.md names a placeholder in another page any '
    + 'more. Phase 6 had one, and it is how the permanent extension ID reaches the integrator '
    + 'documentation. If that step was deliberately retired, delete this section in the same change; do '
    + 'not let it pass silently on zero, which is how a gate stops being a gate.');

for (const { target, tokens } of placeholderSteps) {
    const targetPath = resolve(dirname(docsPath(...CEREMONY)), target);
    const shown = `${target} (${tokens.map((t) => `\`${t}\``).join(', ') || 'no token named'})`;

    assert.ok(existsSync(targetPath),
        `a ceremony step tells the operator to edit ${shown}, and that page does not exist. The step `
        + 'runs immediately after first upload, when the store has just assigned an identifier that is '
        + 'permanent and cannot be re-derived.');

    assert.ok(tokens.length > 0,
        `a ceremony step tells the operator to edit a placeholder in ${target} without naming it in `
        + 'backticks. Name the exact text to replace: "edit the placeholder" sends someone reading '
        + 'under a clock to search a page for something they have to guess the shape of.');

    const page = readFileSync(targetPath, 'utf8');
    assert.ok(tokens.some((t) => page.includes(t)),
        `a ceremony step tells the operator to replace a placeholder in ${shown}, and that page carries `
        + 'none of those. This is exactly what the documentation migration did to bridge.md: it rewrote '
        + 'the sentence holding `chrome-extension://<id>/approval.html` into a generic one, leaving the '
        + 'step aiming at nothing while every path check stayed green. Either restore the placeholder '
        + 'on that page or change the step to name what is really there.');
}

// --- 9. Every stage the frontier names has a row in the stage table -----
//
// Bookkeeping, and it is in a gate because doing it by hand has now failed
// three times in four stages. S24 found §9 had no row for S23 and added it,
// calling the omission "the same class" as the defect it was created to fix;
// S25 then closed a row, landed two commits, and left no row of its own, and
// nobody noticed until S26 went looking. The hand-fix does not generalize
// because the person who forgets to write the row is the same person who
// would have to remember to check for it.
//
// It matters more than tidiness. §9 is the model/effort plan the staged-build
// protocol reads at a stage boundary, and it is the only place a reader who
// has not read the frontier can see what a stage actually did. A frontier that
// reasons from "S25 found X" against a table with no S25 in it is a document
// arguing with itself, and this spec's whole method is that its claims are
// derived rather than asserted.

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const open = spec.indexOf('<!-- BUILD-SPEC:FRONTIER');
    const close = spec.indexOf('<!-- /BUILD-SPEC:FRONTIER');
    assert.ok(open !== -1 && close > open,
        'the  spec has no delimited BUILD-SPEC:FRONTIER block any more. That block is the one '
        + 'place the goal\'s own state is tracked, deliberately in the spec rather than in a sidecar '
        + 'so it cannot drift from it. If it was renamed, repoint this gate in the same change.');

    const frontier = spec.slice(open, close);
    const named = [...new Set([...frontier.matchAll(/\bS(\d{1,2})\b/g)].map((m) => Number(m[1])))];
    const rows = new Set([...spec.matchAll(/^\| S(\d{1,2}) \|/gm)].map((m) => Number(m[1])));

    assert.ok(named.length >= 1,
        'no build stage is named anywhere in the  frontier block. Every stage since S19 has '
        + 'reasoned from what an earlier one measured; a frontier that names none has lost the record '
        + 'this spec argues from. This check must not pass vacuously on zero.');

    const unlisted = named.filter((n) => !rows.has(n)).sort((a, b) => a - b);
    assert.equal(unlisted.length, 0,
        `the  frontier reasons from stages that §9's stage table has no row for: `
        + `${unlisted.map((n) => `S${n}`).join(', ')}. §9 is the model/effort plan the staged-build `
        + 'protocol reads at a stage boundary, and the only account of a stage a reader who skipped the '
        + 'frontier will find. Add the row in the same change as the frontier edit, the way S24 had to '
        + 'add S23\'s and S26 had to add S25\'s.');

    // The same rot, one paragraph higher. S24 found the headline **Status:**
    // paragraph labelled current while two stages old and fixed it by hand,
    // and S25 immediately left it stale again. It is the first thing anyone
    // reads, so a stale one mis-states the spec's own position to every reader
    // who does not scroll as far as the frontier.
    //
    // The live paragraph is the FIRST `**Status:` in the file; the superseded
    // ones below it are labelled `**Superseded status`, which is what makes
    // this derivable at all.
    const statusAt = spec.indexOf('**Status:');
    assert.ok(statusAt !== -1,
        'the  spec has no `**Status:` paragraph. It is the dated, stage-labelled headline a '
        + 'reader meets before anything else; the convention exists because an undated one read as '
        + 'current for two stages while being two stages wrong.');

    const stageInStatus = spec.slice(statusAt, statusAt + 400).match(/after S(\d{1,2})\b/);
    assert.ok(stageInStatus,
        'the  spec\'s headline `**Status:` paragraph no longer says which stage it is current as '
        + 'of. "after S<n>" is what makes it checkable; without it, staleness is invisible again.');

    const latest = Math.max(...named);
    assert.equal(Number(stageInStatus[1]), latest,
        `the  spec's headline status paragraph says it is current after S${stageInStatus[1]}, but `
        + `the frontier below it reasons as far as S${latest}. That paragraph is the first thing a `
        + 'reader meets and the last thing a stage remembers to update: S24 fixed it by hand after it '
        + 'had been two stages stale, and S25 left it stale again the same day.');

    // The floor is the 26 rows standing after S26 added S25's and its own. It
    // is a floor rather than an equality so the table may grow, and it exists
    // so a scrub that empties the table cannot pass this section by leaving
    // the frontier naming nothing.
    assert.ok(rows.size >= 26,
        `§9's stage table carries ${rows.size} stage rows, fewer than the 26 standing after S26. A `
        + 'stage row is the record of what a stage did; deleting one loses that permanently, since the '
        + 'reports directory holds a report for only some stages.');
}

const pointerNote = existsSync(specPath)
    ? `${pointers} §4a private pointers resolved, ${frontierRows.length} live frontier rows verified, `
        + `${mapEntries} translation-map pages resolved`
    : 'the §4a map, the frontier rows and the translation map SKIPPED (platform checkout absent)';

console.log(`OK: extension ceremony-collateral smoke (operator ruling 2026-08-03, one home: `
    + `${steps} checkable steps + ${commandBlocks} fenced blocks on the ceremony page, `
    + `${disclosureSteps} on the disclosure, ${PUBLISHED.length} identity values traced to `
    + `privacy/trader-identity.md, ${extensionHosts.length} egress hosts from wireAudit.js, `
    + `${citations} cited wallet-repo paths resolved across the repo boundary, `
    + `${placeholderSteps.length} cross-page placeholder step verified, ${pointerNote})`);
