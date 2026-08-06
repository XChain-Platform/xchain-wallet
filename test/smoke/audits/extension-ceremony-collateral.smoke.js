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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { egressHostsFor } from '../../../packages/core/src/privacy/wireAudit.js';
import { DOCS_ROOT, docsPath, readDoc, skipUnlessDocs } from '../_docs-repo.js';
import { citationsIn, PLATFORM_ROOT, resolveCitation, SPECS_DIR } from '../_spec-frontier.js';
// §14. The tool is the only thing here that can see what is PUBLISHED; these
// are its own fingerprint functions, so the gate and the tool cannot drift
// into two opinions about what "the same policy" means.
// DEFAULT_URL is aliased: §10 already binds that name from its own dynamic
// import of this module, and a second top-level binding is a SyntaxError that
// kills the whole file at parse time rather than failing one section.
import {
    DEFAULT_URL as CANONICAL_POLICY_URL, policyFingerprint, policyTextFromMarkdown,
} from '../../../tools/release/verify-privacy-url.mjs';

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

// S30, and it is this file's own instance of the defect the whole spec is
// about: a second copy of something the code already knew.
//
// This used to hand-derive the platform root as `walletRoot/..`, while
// `resolveCitation`, imported from the shared module a few lines up, derives
// it from `XCHAIN_PLATFORM_ROOT` with that same path only as a fallback. The
// two agree on this machine and nowhere else, and the failure is not the quiet
// one it sounds like. Driven with `XCHAIN_PLATFORM_ROOT=/nonexistent`: section
// 6 still FOUND the spec (its own derivation ignored the override) and then
// resolved every citation in it against the override, so the gate went RED
// accusing the frontier of citing paths that are all perfectly fine. A check
// that is red when nothing is wrong is one people waive, which is exactly what
// S17 and S20 record happening here before.
//
// One derivation now, the shared module's, so the override either moves both
// halves or neither. built that module and documents the variable as
// the way to run these gates from an isolated checkout; five sections here
// were silently opting out of it.
const specPath = join(SPECS_DIR, 'wallet-publishing-chrome-extension.md');
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
        // PLATFORM_ROOT, not `walletRoot/..`, for the reason given at specPath:
        // one derivation, so an override cannot move the document without also
        // moving the paths the document is checked against.
        if (!existsSync(join(PLATFORM_ROOT, m[1]))) missing.push(m[1]);
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
    //
    // The parsing and resolution moved to test/smoke/_spec-frontier.js when
    // ported this section to EVERY spec (the same rot was live in the
    // desktop and android publishing specs, and nothing checked them). This
    // block therefore no longer owns the rule; it keeps the chrome-specific
    // failure message and delegates, so the two cannot drift apart.
    const dead = [];
    for (const { id, line } of frontierRows) {
        for (const cited of citationsIn(line).paths) {
            if (!resolveCitation(cited).ok) dead.push(`row ${id} cites ${cited}`);
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

// --- 10. The value the store form validates has a real source ----------
//
// Section 8's defect, found again one field over, and this one sat on the only
// field the Chrome Web Store form actually validates.
//
// Phase 3 said "the canonical URL is the one the wallet's privacy policy
// publishes, take it from there rather than retyping it, so there is only ever
// one copy of it", and Phase 5's table sourced the same field the same way.
// Measured 2026-08-03: privacy/privacy-policy.md has never contained that URL.
// It names three documentation pages and an issue tracker and never its own
// hosted address, so the sentence guarding against a second copy of the value
// was itself pointing at a page holding no copy at all. An operator reaching
// that step has nothing to transcribe and retypes from memory, which is how
// the slashless form gets pasted; Phase 3 warns two paragraphs earlier that a
// redirect hop is a failure under review.
//
// The fix was to stop sourcing it from a document. The check the operator
// already runs in that phase prints the URL as the first line of its output,
// so the string that was verified live and the string pasted into the console
// are the same one. This section holds that arrangement together from both
// ends: the constant is imported from the tool rather than restated here, and
// the tool is DRIVEN rather than read, because "it prints the URL" is exactly
// the kind of claim this spec keeps finding to be false.

const { DEFAULT_URL } = await import('../../../tools/release/verify-privacy-url.mjs');

assert.ok(/^https:\/\/\S+\/$/.test(DEFAULT_URL),
    `verify-privacy-url.mjs exports DEFAULT_URL as "${DEFAULT_URL}", which is not an https URL with a `
    + 'trailing slash. The trailing slash is load-bearing: the ceremony tells the operator to paste the '
    + 'canonical form because a redirect hop under review is a failure.');

// The tool must actually hand the operator the value, with no network needed.
const help = execFileSync('node', [join(walletRoot, 'tools/release/verify-privacy-url.mjs'), '--help'],
    { encoding: 'utf8' });
assert.ok(help.includes(DEFAULT_URL),
    'verify-privacy-url.mjs --help no longer prints the canonical URL it defaults to. The ceremony '
    + 'sends the operator to this tool for that value; a tool that will not say what it checks sends '
    + 'them back to retyping it from memory, which is the defect this section exists for.');

// Positively: the page has to tell the operator that the check's own output is
// where the value comes from. Without this the section could be satisfied by a
// ceremony that says nothing about the URL at all, and saying nothing is how
// the operator ends up retyping it.
const ceremonyLines = ceremony.split('\n');
assert.ok(ceremonyLines.some((l) => /canonical URL/i.test(l) && l.includes('`url:')),
    'no line of the ceremony points the operator at the `url:` line the Phase 3 check prints as the '
    + 'source of the canonical policy URL. That arrangement is the whole fix: the string verified live '
    + 'and the string pasted into the console are then the same one. If the source moved, move this '
    + 'assertion with it, in the same change.');

// Negatively: no line may go back to sourcing the value from a page that does
// not carry it. Scoped to an explicit sourcing instruction aimed at a linked
// page, NOT to any mention of the canonical URL beside a link. The first cut
// was the looser rule and it fired on correct writing: "the hosted page is
// generated from [the privacy policy] by the website build, and the site's
// canonical URL carries a trailing slash" describes provenance and tells the
// operator to source nothing. A check that fires on correct writing is one
// people delete, which is this spec's own S14 lesson turned on this section.
const SOURCING = /take it from|publishes|copy it (out )?of|transcribe it from/i;
const urlSourceLines = ceremonyLines.filter((l) =>
    /canonical (URL|hosted address)/i.test(l) && /\]\(\.\.[^)]*\.md\)/.test(l) && SOURCING.test(l));

for (const line of urlSourceLines) {
    const target = line.match(/\]\((\.\.[^)#]+\.md)(?:#[^)]*)?\)/)[1];
    const page = readFileSync(resolve(dirname(docsPath(...CEREMONY)), target), 'utf8');
    assert.ok(page.includes(DEFAULT_URL),
        `the ceremony sources the canonical privacy-policy URL from ${target}, and that page does not `
        + `contain ${DEFAULT_URL}. That is the 2026-08-03 defect exactly: the sentence forbidding a `
        + 'second copy of this value pointed at a page holding no copy of it. Source it from the check '
        + 'that prints it, or put the value on that page.');
}

// --- 11. A step's linked procedure must not contradict the step ---------
//
// The same class as sections 8 and 10, and the sharpest instance of it: here
// the link resolved, the page existed, and its contents told the operator to
// do the exact thing the step forbids.
//
// Phase 8's third exit criterion requires connect and sign driven "from the
// store-installed build specifically, not a local development build", and
// linked the test-dapp runbook as a whole. That runbook opens with `pnpm -C
// packages/extension build` and "Load unpacked", which is a local development
// build. An operator following the link did the forbidden thing and ticked a
// public-flip exit criterion having proved nothing about the shipped artifact.
//
// So the rule is not "the link resolves" but "the linked SECTION covers what
// the step asks for". Derived from the step's own words: the criterion says
// store-installed, so the section it points at has to be about installing from
// the store, and must not be the load-unpacked path.

const storeInstalledSteps = ceremonyLines.filter((l) =>
    /^[⬜✅]/.test(l) && /store-installed/.test(l));

assert.ok(storeInstalledSteps.length >= 1,
    'no checkable step requires the store-installed build any more. Phase 8 had one, and it is the only '
    + 'criterion that proves the artifact the store actually served can sign. Do not let this pass '
    + 'vacuously on zero.');

for (const line of storeInstalledSteps) {
    const link = line.match(/\]\(([^)#]+\.md)#([a-z0-9-]+)\)/);
    assert.ok(link,
        'the store-installed exit criterion does not link a specific SECTION of a procedure (it needs a '
        + 'page.md#anchor link). Linking the runbook as a whole is what sent the operator to its '
        + 'load-unpacked opening, which is the build this criterion exists to exclude.');

    const [, target, anchor] = link;
    const page = readFileSync(resolve(dirname(docsPath(...CEREMONY)), target), 'utf8');
    const slug = (h) => h.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    const headings = [...page.matchAll(/^#{2,4} (.+)$/gm)].map((m) => m[1]);

    const idx = headings.findIndex((h) => slug(h) === anchor);
    assert.ok(idx !== -1,
        `the store-installed exit criterion links ${target}#${anchor}, and that page has no heading with `
        + `that anchor. Its headings slug to: ${headings.map(slug).join(', ')}. An anchor that does not `
        + 'resolve drops the operator at the top of the page, which is the load-unpacked procedure.');

    // The section body: from its heading to the next heading of any level.
    const start = page.indexOf(`## ${headings[idx]}`);
    const rest = page.slice(start + 1);
    const nextAt = rest.search(/^#{2,4} /m);
    const section = nextAt === -1 ? rest : rest.slice(0, nextAt);

    assert.ok(/store link|from the store|unlisted item/i.test(section),
        `${target}#${anchor} is what the store-installed criterion sends the operator to, and that `
        + 'section never tells them to install from the store. That is the whole content of the '
        + 'criterion; a section that does not say it cannot satisfy it.');

    assert.ok(!/Load unpacked/i.test(section) || /not a sideload|replace section 1|rather than/i.test(section),
        `${target}#${anchor} tells the operator to "Load unpacked", which is the local development build `
        + 'this criterion explicitly excludes. If the section mentions it in order to rule it out, say '
        + 'so in the same sentence so a skimming reader cannot follow it by accident.');
}

// --- 12. A command can resolve, run, exit 0, and measure the wrong thing -
//
// Sections 8, 10 and 11 ask what a linked PAGE says. This one is the same
// question asked of a linked COMMAND, and the answer was worse, because a
// command that measures the wrong artifact still exits 0 and prints a verdict.
//
// The disclosure's "before you tick anything" block said: run
// `remote-code-audit.mjs`, and "the remote-code answer is a measurement rather
// than a memory". Driven 2026-08-04: it exits 0 and reports the shipped bundle
// clean. It defaults to packages/extension/dist, which is gitignored, was two
// days old on the machine that ran it, and is built from whatever the shared
// worktree happened to hold. The submission runbook's own build-provenance
// phase refuses a locally built zip for upload in exactly those words. So the
// ceremony verified one artifact and shipped another, on a store answer that
// is permanent and public.
//
// The script already took an optional directory argument, so the fix was to
// use it. This section holds both ends: the step must pass one, and the script
// must still honour it. The second half is DRIVEN, not read, because "it
// accepts a directory" is precisely the kind of claim that rots silently.

const AUDIT = 'packages/extension/scripts/remote-code-audit.mjs';
const auditSteps = disclosure.split('\n').filter((l) => /^[⬜✅]/.test(l) && /remote.code audit/i.test(l));

assert.equal(auditSteps.length, 1,
    `the disclosure carries ${auditSteps.length} checkable steps about the remote-code audit, expected 1. `
    + 'That step is what turns the store form\'s permanent remote-code answer into a measurement; if it '
    + 'was split or retired, update this section in the same change.');

// The command block under that step has to name the audit AND give it a target.
const auditBlock = disclosure.slice(disclosure.indexOf(auditSteps[0]));
const auditCmd = auditBlock.match(new RegExp(`node\\s+${AUDIT.replace(/[.]/g, '\\.')}([^\\n]*)`));
assert.ok(auditCmd,
    `the disclosure's remote-code step no longer shows the ${AUDIT} command. An operator answering a `
    + 'permanent store question from a step with no command in it is answering from memory.');

assert.ok(auditCmd[1].trim().length > 0,
    `the disclosure runs ${AUDIT} with no directory argument, so it audits its default `
    + 'packages/extension/dist. That path is gitignored, locally built, and can be days stale; the '
    + 'runbook refuses a locally built zip for upload for the same reason. Point it at the unpacked '
    + 'release artifact instead.');

assert.ok(/release-artifacts|the artifact being uploaded/i.test(auditBlock.slice(0, 1200)),
    'the disclosure gives the remote-code audit a directory, but never ties that directory to the '
    + 'release artifact being uploaded. Any directory satisfies a command; only the shipped one '
    + 'satisfies the claim that the answer is a measurement.');

// And the script must actually honour a directory argument. Driven against a
// throwaway tree, because a default that silently ignores argv[2] would put
// the original defect straight back with the documentation looking correct.
{
    const probe = join(tmpdir(), `xc997-audit-probe-${process.pid}`);
    mkdirSync(probe, { recursive: true });
    writeFileSync(join(probe, 'probe-marker.js'), 'export const x = 1;\n');
    try {
        const out = execFileSync('node', [join(walletRoot, AUDIT), probe], { encoding: 'utf8' });
        assert.ok(out.includes(probe),
            `${AUDIT} was given ${probe} and its report does not name that directory, so the directory `
            + 'argument the disclosure depends on is not being honoured. The operator would audit the '
            + 'local build while believing they audited the release artifact.');
    } finally {
        rmSync(probe, { recursive: true, force: true });
    }
}

// --- 13. Every release script answers --help, and answers ONLY --help ---
//
// The first section here that generalizes. Sections 8, 10, 11 and 12 each hold
// ONE step to its referent, which S28 noted is a weakness: the next defect is
// wherever those four are not pointed.
//
// Not a style rule. The failures found on 2026-08-04 were actively misleading,
// and each was worst at the moment it would actually be typed:
//
//   remote-code-audit.mjs --help      ->  "no build at --help" (exit 2)
//   verify-validated-commit.mjs --help->  "RELEASE GATE REFUSED" (exit 1)
//   ios-archive.sh --help             ->  "APPLE_API_KEY ... is required" (1)
//   verify-release-key.sh --help      ->  "unknown argument: --help" (exit 1)
//
// The first reads as a broken build to someone looking up the argument syntax
// that S28 had just made load-bearing. The second announces, in the loudest
// words that tool owns, that the release was rejected, to someone who only
// asked how to invoke it. `--help` is what people type when a command refuses
// them, which is exactly when a release ceremony is already going badly.
//
// TWO THINGS CHANGED HERE ON 2026-08-04 (), and each closes a hole
// that a passing run of the previous cut had proved it could not see.
//
// (a) THE SUBJECT IS THE DIRECTORY, NOT THE PAGES. The previous cut harvested
//     tool names out of the two ceremony pages plus the  spec frontier,
//     which had two consequences. It covered only the Chrome subset, leaving
//     the mobile and desktop lanes unchecked - nine scripts with NO `--help`
//     handling at all, which is the more dangerous half. And the frontier half
//     of the harvest read a repo that is this repo's PARENT and therefore
//     cannot be a `.ci-siblings` entry, so on the venue that actually gates a
//     push it silently harvested one tool fewer and still cleared its floor.
//     A check whose subject lives in a repo the venue does not check out is
//     not a check in that venue. Scanning `tools/release/` and
//     `packages/extension/scripts/` removes both problems at once: the subject
//     is entirely inside this repo, so the venue evaluates exactly what a
//     local run does, and a script ADDED to either directory is covered on the
//     day it lands rather than on the day someone remembers to name it.
//
//     The pages are still read, for the one thing the scan cannot say: that
//     nothing the ceremony hands an operator lives OUTSIDE the scanned
//     directories. That is the assertion, not a second harvest.
//
// (b) EXIT 0 IS NOT THE PROPERTY. It was the whole test, and it is satisfied
//     by the worst behaviour in this class rather than by the best. Measured,
//     not reasoned:
//
//       capture-listing-screenshots.mjs  did not recognise `--help` as a flag,
//         so it ran the FULL capture - launched a browser, created and
//         unlocked a demo wallet, drove the UI - and overwrote three of the
//         four store listing assets on disk. Exit 0, because the work
//         succeeded.
//       emulation-preflight.sh           took `--help` as its one positional,
//         a Docker platform, and printed `host arm64 must EMULATE --help`.
//         Exit 0.
//       capture-update-check.mjs         ran the default capture and
//         OVERWROTE docs/update-check-capture.json, the file the download
//         page's privacy copy is checked against. Exit 0.
//       rehearsal-matrix.mjs             printed nothing whatsoever. Exit 0.
//
//     An unrecognized flag is not ignored, it is CONSUMED. So three properties
//     are required, and each rules out one of the four shapes above:
//
//       1. exit 0                    the original property
//       2. real usage on stdout      a usage line, this script's own name, and
//                                    more than a token of text. Rules out the
//                                    silent module and the tool that printed
//                                    its work output instead.
//       3. the worktree is unchanged rules out the tool that DID the work.
//                                    `git status --porcelain` before and after
//                                    each run. This is the one that would have
//                                    caught the listing-asset overwrite, which
//                                    is the defect that started this.
//
//     Property 3 reads the shared worktree, so a neighbouring session writing
//     a file during the sub-second window a script runs in would surface here
//     as a false red naming that file. That is the documented cost of checking
//     side effects at all, it is loud rather than silent, and on the CI venue
//     (a clean checkout, one writer) it is deterministic.

const toolRe = /(tools\/release\/[a-z0-9-]+\.(?:mjs|sh)|packages\/extension\/scripts\/[a-z0-9-]+\.(?:mjs|sh))/g;

// Recursive on purpose: `tools/release/drills/` holds deb-update-swap.mjs,
// whose one positional is a directory it INSTALLS SYSTEM PACKAGES from. A
// non-recursive scan (and the old page regex, which could not match a nested
// path) left the single most side-effecting script in the tree uncovered.
const SCRIPT_DIRS = ['tools/release', 'packages/extension/scripts'];

const walkScripts = (relDir) => {
    const out = [];
    for (const entry of readdirSync(join(walletRoot, relDir), { withFileTypes: true })) {
        const rel = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walkScripts(rel));
        else if (/\.(mjs|sh)$/.test(entry.name)) out.push(rel);
    }
    return out;
};

const releaseScripts = SCRIPT_DIRS.flatMap(walkScripts).sort();

// The floor is 29: the scripts COMMITTED at HEAD on 2026-08-04, when every one
// of them was driven and made to pass. It was briefly written as 28, before
// emulation-preflight.sh's own --help landed in c54af492 () and made
// it tracked; the number is re-derived from `git ls-files` rather than from
// what happens to be sitting in the worktree, because the venue gates the
// COMMITTED tree. A floor taken from uncommitted neighbours (release-record.mjs
// is one today, and it passes too) would go red on every clean checkout until
// somebody else's commit landed.
//
// It is a floor rather than an equality so the directories may grow; a SHRINK
// means either a tool was deleted (fine, lower this deliberately and say why)
// or the scan broke (not fine, and the previous cut of this section proved a
// broken scan reports OK while checking less).
assert.ok(releaseScripts.length >= 29,
    `only ${releaseScripts.length} release scripts were found under ${SCRIPT_DIRS.join(' and ')}, `
    + 'fewer than the 29 committed when this section was measured. A scan that finds less than it '
    + 'should still prints a verdict, which is exactly how the page-harvest cut of this section hid '
    + 'a tool it had stopped checking.');

const harvestTools = (text) => [...new Set([...text.matchAll(toolRe)].map((m) => m[1]))]
    .filter((t) => existsSync(join(walletRoot, t))).sort();

// The pages' role now: not a source of subjects, a check on the scan's scope.
// If the ceremony ever hands an operator a script living somewhere else, the
// directory scan would not cover it and would say nothing about that.
const pageTools = harvestTools([ceremony, disclosure].join('\n'));

assert.ok(pageTools.length >= 7,
    `only ${pageTools.length} runnable tools were found named on the two ceremony pages, fewer than `
    + 'the seven this section was written against. If the pages stopped naming commands, section 1 '
    + 'should have failed first; if this harvest broke, fix it rather than lowering the floor.');

const outsideScan = pageTools.filter((t) => !releaseScripts.includes(t));
assert.equal(outsideScan.length, 0,
    `the ceremony pages hand the operator ${outsideScan.join(', ')}, which the release-script scan `
    + `does not cover (it reads ${SCRIPT_DIRS.join(' and ')}). Either move the tool into one of those `
    + 'directories or widen the scan in the same change: a tool an operator is told to run and no '
    + 'gate exercises is precisely the gap this section was widened to close.');

// Property 3's instrument. Asserted to work before it is trusted: a `git` that
// errors would otherwise make every comparison trivially equal, which is the
// silent-pass shape this file refuses everywhere else.
const worktreeState = () => execFileSync('git', ['status', '--porcelain'],
    { cwd: walletRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let worktreeReadable = true;
try {
    worktreeState();
} catch {
    worktreeReadable = false;
}
assert.ok(worktreeReadable,
    '`git status --porcelain` failed in the wallet checkout, so the side-effect half of this section '
    + 'cannot run. It is not optional: exit 0 alone is satisfied by a script that does its work and '
    + 'succeeds, which is the defect measured. Fix the checkout rather than skipping this.');

for (const tool of releaseScripts) {
    const runner = tool.endsWith('.sh') ? 'bash' : 'node';
    const before = worktreeState();

    let ok = true;
    let stdout = '';
    let first = '';
    try {
        stdout = execFileSync(runner, [join(walletRoot, tool), '--help'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    } catch (e) {
        ok = false;
        stdout = String(e.stdout || '');
        first = String(e.stdout || e.stderr || '').split('\n').filter(Boolean)[0] || '(no output)';
    }

    const after = worktreeState();

    // 1. exit 0.
    assert.ok(ok,
        `${tool} does not answer --help with exit 0. It said: "${first.slice(0, 120)}". Release tools `
        + 'are typed by an operator mid-ceremony, and --help is what anyone types when a command '
        + 'refuses them. A tool that answers it with its own failure vocabulary turns a question into '
        + 'an emergency: remote-code-audit.mjs used to report "no build at --help", '
        + 'verify-validated-commit.mjs used to answer "RELEASE GATE REFUSED", and ios-archive.sh used '
        + 'to demand APPLE_API_KEY.');

    // 3. No side effects. Checked before the output shape because it is the
    //    consequential one: a wrong help screen wastes a minute, an overwritten
    //    listing asset ships to a store.
    assert.equal(after, before,
        `${tool} --help CHANGED THE WORKTREE. git status went from ${before.split('\n').filter(Boolean).length} `
        + `entries to ${after.split('\n').filter(Boolean).length}. Asking a tool how to use it must not `
        + 'be doing the thing it does. capture-listing-screenshots.mjs used to run a full browser '
        + 'capture on --help and overwrite three of the four Chrome store listing assets, exiting 0 '
        + 'because the work succeeded; capture-update-check.mjs used to overwrite the update capture '
        + 'the download page is checked against. (If a neighbouring session wrote a file during this '
        + `run, the entry named here will be unrelated to ${tool} - re-run before believing it.)`);

    // 2. Real usage, not silence and not the tool's own work output. Three
    //    cheap, independent signals; a script that ran its work passes none.
    const lines = stdout.split('\n').filter((l) => l.trim());
    const base = tool.slice(tool.lastIndexOf('/') + 1);
    // Anchored to a line start, so `usage:` inside a sentence does not count,
    // but tolerant of a comment prefix: the bash tools print their own header
    // block verbatim (`awk` between the licence rule and the first line of
    // code), so their usage line arrives as `# Usage:`. Printing the header is
    // deliberate there - it cannot drift from the documentation it IS.
    const USAGE_LINE = /^[\s#*/>-]*usage:/im;
    assert.ok(USAGE_LINE.test(stdout) && stdout.includes(base) && lines.length >= 3,
        `${tool} exits 0 on --help without printing usage (a "Usage:" line, its own name, and more `
        + `than a couple of lines). It printed ${lines.length} line(s): `
        + `"${(lines[0] || '(nothing at all)').slice(0, 100)}". Exit 0 is not the property - it is `
        + 'satisfied by every shape of this defect. rehearsal-matrix.mjs printed nothing at all and '
        + 'exited 0; emulation-preflight.sh took --help as its Docker-platform positional and '
        + 'reported "host arm64 must EMULATE --help", also exiting 0. Both read, to a person and to '
        + 'the previous cut of this gate, as a help screen having been shown.');
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

// The absent branch names §9 as well, which it did not until S30: it reads the
// same spec as §§5-7 and degraded to nothing with the output saying so nowhere.
// A summary line that reports only the sections which announce their own skip
// is how a partial run reads as a full one.
//
// §13 is no longer on that list, and that is the point of's rewrite:
// its subject is two directories in THIS repo, so it reports the same number
// on the venue as it does locally, and there is no half of it left to skip.
const toolNote = `${releaseScripts.length} release scripts answer --help with usage, exit 0 and no `
    + `side effects (${pageTools.length} of them named on the ceremony pages)`;

const pointerNote = existsSync(specPath)
    ? `${pointers} §4a private pointers resolved, ${frontierRows.length} live frontier rows verified, `
        + `${mapEntries} translation-map pages resolved, ${toolNote}`
    : `${toolNote}; the §4a map, the frontier rows, the translation map and the §9 stage table all `
        + 'SKIPPED (platform checkout absent, as on every CI run: it is this repo\'s parent, not a '
        + 'sibling)';

// --- 14. The policy the store validates is PUBLISHED, not merely written ---
//
// S30 ended by naming the next question: the other gates all read the docs
// sibling, and `.ci-siblings` ships it at origin/master while a developer
// machine reads a dirty working tree, so ask whether each gate's subject is
// the same REVISION in both venues. It measured the answer as "real in shape,
// absent in fact: all five pages byte-identical to origin/master". That was
// true for one day. On 2026-08-05 the analytics-rollout lane edited
// privacy/privacy-policy.md - the single page of the five whose DEPLOYED copy
// the Chrome Web Store form validates - and `verify-privacy-url.mjs` went to
// exit 1 while the whole smoke suite stayed green.
//
// THE OBVIOUS CHECK IS THE WRONG ONE, and building it first is how this would
// have been missed a fifth time. Comparing the working tree against
// origin/master goes GREEN the moment the editing lane COMMITS, which is
// precisely the state where the gap is real and unattended: written, pushed,
// not deployed. Git can only ever see what would be published.
//
// So the subject is the DEPLOY, and the anchor is docs/privacy-deploy-pin.json.
// verify-privacy-url.mjs is the one thing in this repo that fetches, and on a
// confirmed live observation it writes down the fingerprint of the policy text
// it actually saw being served. This section compares the canonical policy
// against that note. It is red from the moment the canonical text moves and
// stays red until someone REDEPLOYS and re-runs the tool - it follows the
// deploy rather than the commit, which is the whole point.
//
// This spec has now been wrong about this four times (S10's 404, S17's edge
// obfuscation, S22's stale policy, S31's), and every time the sentence in the
// spec that should have prevented it was PROSE addressed to whoever edits the
// policy. The lane that edited it this time has never read this spec. A rule
// that depends on its reader having read it is not a mechanism.
const policyMarkdown = readDoc('privacy', 'privacy-policy.md');
const canonicalFingerprint = policyFingerprint(policyTextFromMarkdown(policyMarkdown));

// Venue drift, declared rather than asserted. A developer legitimately edits a
// docs page before committing, so this is not a failure on its own - but S30's
// §13 finding was that a check which degrades quietly still prints a verdict,
// so local-green and CI-green must be distinguishable by reading the output.
// The subject is the whole wallet docs tree rather than a list of pages: a
// list is the thing that rots, and `docsPath` is variadic so a call-site
// harvest would silently miss any computed or multi-argument reader.
let driftNote;
try {
    const drifted = execFileSync('git',
        ['-C', DOCS_ROOT, 'diff', '--name-only', 'origin/master', '--', 'components/wallet'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        .split('\n').map((l) => l.trim()).filter(Boolean);
    driftNote = drifted.length
        ? `${drifted.length} wallet docs page(s) differ from origin/master (${drifted.join(', ')}), `
            + 'so this run read text the CI venue will not'
        : 'wallet docs match origin/master, so this run read what the CI venue reads';
} catch (err) {
    // Not a pass. An unfetched or absent origin is a thing this section could
    // not look at, and saying "no drift" would be a confident wrong answer.
    driftNote = `wallet docs revision NOT COMPARED (${String(err.message).split('\n')[0]}), `
        + 'so whether this run read what CI reads is unknown';
}

const pinPath = join(walletRoot, 'docs', 'privacy-deploy-pin.json');
assert.ok(existsSync(pinPath),
    `FAIL: ${pinPath} is missing, so nothing records that the published privacy policy was ever `
    + 'observed live. The Chrome Web Store form validates that URL. Run '
    + '`node tools/release/verify-privacy-url.mjs`; on exit 0 it writes the pin.');

const pin = JSON.parse(readFileSync(pinPath, 'utf8'));

// ROW 32, and it is this gate's own defect one stage old. The assertion below
// compared the hash and only PRINTED the URL, so a pin recorded at any address
// satisfied it. Driven rather than reasoned: a pin carrying the correct policy
// hash and the URL `https://staging.internal/policy/` passed the previous cut.
//
// That is not a hypothetical, because --url exists and is meant to be used: a
// run against a staging host observes a real page, writes an honest pin, and
// silently retires the evidence about the address the store form actually
// validates. The hash answers "is this the current policy text"; nothing
// answered "somewhere anybody cares about". D5 fixed one canonical URL,
// trailing slash included, and this is the field S27's row 21 already found
// this ceremony sourcing from a page that never carried it.
//
// Checked BEFORE the hash, because a pin from elsewhere makes the hash
// comparison meaningless rather than merely incomplete.
assert.equal(pin.url, CANONICAL_POLICY_URL,
    `FAIL: the deploy pin was recorded at ${pin.url}, not at the URL the Chrome Web Store form `
    + `validates (${CANONICAL_POLICY_URL}). Whatever was observed, it was not the published policy, so this `
    + 'gate can say nothing about what a store reviewer will load. Re-run '
    + '`node tools/release/verify-privacy-url.mjs` with no --url override.');

assert.equal(pin.policySha256, canonicalFingerprint,
    'FAIL: the canonical privacy policy is NOT the one being served at the URL the Chrome Web '
    + 'Store form validates.\n'
    + `  canonical (xchain-documentation): ${canonicalFingerprint}\n`
    + `  last observed live at ${pin.url}: ${pin.policySha256} (${pin.observedAt})\n`
    + `  ${driftNote}\n`
    + '  This is a DEPLOY gap, not a build gap, and rebuilding is not publishing. The policy is\n'
    + '  finished when the live URL serves it, in this order:\n'
    + '    1. land the change in xchain-documentation (components/wallet/privacy/privacy-policy.md)\n'
    + '    2. rebuild xchain-websites: node xchain.io/build/privacy.build.js,\n'
    + '       then npm run build:docs && npm run build:og, and DEPLOY it\n'
    + '    3. node tools/release/verify-privacy-url.mjs   # exit 0 advances the pin, closing this\n'
    + '  Diagnose which of the three is missing WITHOUT deploying anything: point the tool at the\n'
    + '  built page with --html <xchain-websites>/xchain.io/wallet/privacy/index.html. Exit 0 there\n'
    + '  means the build is already correct and only publication is missing.\n'
    + '  CHECK THE COUPLING FIRST. The policy edit may be one piece of a larger undeployed change\n'
    + '  (2026-08-05: a 122-file analytics rollout), in which case publishing the policy ALONE\n'
    + '  makes it describe behaviour the site does not yet have. That is the overstating direction\n'
    + '  of the same policy/disclosure disagreement this gate exists to prevent. Deploy together.\n'
    + '  Until then ceremony Phase 3 does not pass and the listing must not be submitted: a store\n'
    + '  reviewer cross-checks the hosted policy against the data-disclosure answers.');

// --- 15. Arming the monitor has to check IDENTITY, not just presence -------
//
// Row 31. The rogue-publish monitor is this spec's security control for a
// compromised publisher account, and it lives on a host no test can reach. Its
// row was "verified" by three separate stages, and every one of them measured
// that a file EXISTS at the install path. Measured 2026-08-05, the installed
// copy and the repo copy had already diverged (`75c26eb3...` at 19176 bytes
// against `47d1f7a7...` at 19244).
//
// That is S26's lesson, which this gate already enforces for documentation in
// §8: a citation has two halves, the address and the contents, and checking
// only the address is how a step comes to point at nothing. §8 applies it to a
// page. Nothing applied it to a deployed BINARY ARTIFACT, which is the same
// defect with a worse blast radius, because a page that says the wrong thing
// is read by a person and a monitor that is the wrong version is read by
// nobody.
//
// THE FIX IS A CEREMONY STEP RATHER THAN A CONTINUOUS CHECK, deliberately.
// The suite cannot reach the host, and the S31 pin pattern (let the tool that
// CAN observe write a note the suite reads) would need a NEW tool that holds
// SSH credentials, which is a real security surface to add for what turned out
// to be a help-text drift. The drift also cannot matter until the monitor is
// armed, and arming happens once, in Phase 8, by hand. So the check belongs at
// the one moment the artifact matters, and this section holds the ceremony to
// still carrying it.
//
// The published page states this generically ("the installed copy"), never by
// hostname: §5 forbids internal hostnames on a public page, and this artifact
// lives on one.
const monitorSteps = ceremony.split('\n').filter((l) => /store-version-monitor/.test(l));
assert.ok(monitorSteps.length >= 2,
    'FAIL: the ceremony describes the store-version monitor in fewer than two steps. Arming it '
    + 'asks two separate questions (is the JOB running, and is the INSTALLED SCRIPT the reviewed '
    + 'one) and they are easy to collapse into one. Row 31 exists because only the first was ever '
    + `asked. Found ${monitorSteps.length} step(s).`);

const identityStep = monitorSteps.find((l) => /sha256/i.test(l));
assert.ok(identityStep,
    'FAIL: no step tells the operator to compare the INSTALLED monitor against the reviewed one by '
    + 'checksum. Measured 2026-08-05: the installed copy and the repo copy had already diverged, '
    + 'and every earlier verification of that row checked only that a file existed at the path. A '
    + 'file at the right path is not evidence that it is the right file.');

// The comparison has to have a SUBJECT, and the subject has to be a COMMAND.
// The first cut of this assertion accepted the words "release tag" appearing
// anywhere nearby, and a mutation that deleted the actual comparison still
// passed it, because the prose underneath happens to say "reinstall from the
// release tag". Prose about a check is not a check. So both halves of the
// comparison must be present as runnable commands: a hash of the installed
// file, and a hash taken from the release tag rather than from the working
// tree, which can hold anything.
const identityWindow = ceremony.slice(ceremony.indexOf(identityStep))
    .split('\n').slice(0, 14).join('\n');
assert.ok(/git show[^\n]*store-version-monitor[^\n]*sha256sum/.test(identityWindow),
    'FAIL: the checksum step never says what the installed copy must MATCH, as a command. A hash '
    + 'with nothing to compare it against is a number, not a check, and prose naming the release '
    + 'tag is not a comparison. The step needs the second hash taken from the tag itself '
    + '(git show <release-tag>:tools/release/store-version-monitor.mjs | sha256sum).');

// --- 16. A BLOCKER the page states has to be anchored to the thing that clears it ---
//
// §14 anchored a published page to the deploy that publishes it, and its
// closing lesson generalized past privacy policies: for any fact whose
// subject lives OUTSIDE this repo, git cannot see it, so a document that
// depends on that fact ends up hardcoding it, and a hardcoded fact rots. The
// question it left was which other outside-the-repo dependency has no note.
//
// The release signing key is one, and it is the one Phase 4 turns on. It
// lives in a GNUPGHOME on the release machine. Measured 2026-08-06: the key
// ceremony had run the previous evening and the key signs, while Phase 4 of
// the ceremony page still read "this phase cannot be completed before the
// release-signing key exists ... and therefore no upload in Phase 6".
//
// THAT DIRECTION IS THE WORSE ONE, which is why this section exists rather
// than a note in the frontier. Every other instance of this defect in this
// spec made unfinished work look finished. A stale BLOCKER makes available
// work look impossible, and it survives longer because nobody re-measures a
// blocker: the frontier said the same thing for six stages, and when the
// third clause of its own standing instruction was finally exercised, both
// halves of the Phase 4 blocker turned out to be already satisfied.
//
// So the page may no longer assert either state. It is held to
// docs/release-key-pin.json, which verify-release-key.sh writes only after
// signing a manifest for real, and the EMPTY state is checked as strictly as
// the filled one - a guard that starts working only after the event it
// guards is not a guard.
const keyPinPath = join(walletRoot, 'docs', 'release-key-pin.json');
const phase4 = ceremony.slice(ceremony.indexOf('### Phase 4'),
    ceremony.indexOf('### Phase 5'));
assert.ok(phase4.length > 0,
    'FAIL: Phase 4 (build artifact provenance) is not on the ceremony page. It is the phase that '
    + 'ties the uploaded zip to a signed release manifest, and the store assigns a permanent '
    + 'extension ID to whatever is uploaded first.');

// The claim the page must not make on its own authority, in either direction.
const assertsNoKey = /cannot be completed before the release-signing key exists/.test(phase4)
    || /[Uu]ntil the key ceremony lands/.test(phase4);

if (!existsSync(keyPinPath)) {
    // No note means nobody has proved the key signs on this machine. The page
    // must say so plainly, because the alternative failure is the dangerous
    // one: an operator uploads a zip with no signed manifest behind it, and
    // the first upload is what the store binds the permanent ID to.
    assert.ok(/release-key-pin\.json/.test(phase4) && /verify-release-key\.sh/.test(phase4),
        `FAIL: ${keyPinPath} is absent, so nothing records that the release signing key was ever `
        + 'observed signing, and Phase 4 does not tell the operator that or how to fix it. The '
        + 'phase must name the note and the command that writes it '
        + '(bash tools/release/verify-release-key.sh --key <fingerprint>).');
} else {
    const keyPin = JSON.parse(readFileSync(keyPinPath, 'utf8'));

    assert.ok(!assertsNoKey,
        'FAIL: Phase 4 still tells the operator the phase cannot be completed until the release '
        + `key ceremony runs, but ${keyPinPath} records that it already has (${keyPin.observedAt}: `
        + `${keyPin.proved}). That is a blocker outliving the fact, which is the direction that `
        + 'makes available work look impossible. Correct the phase text; do not delete the note.');

    assert.ok(/release-key-pin\.json/.test(phase4),
        'FAIL: Phase 4 no longer states the key blocker and does not name the note it was replaced '
        + `by (${keyPinPath}). The phase then asserts nothing about the key at all, which is worse `
        + 'than the stale claim: an absent note would stop nobody.');

    // The note has to be an OBSERVATION, not a placeholder. Row 31's defect
    // was a check that measured presence where it needed identity, and a pin
    // file is exactly the kind of artifact that gets hand-created empty.
    assert.ok(/^[0-9A-F]{40}$/.test(String(keyPin.fingerprint || '')),
        `FAIL: ${keyPinPath} carries no 40-hex uppercase fingerprint (${keyPin.fingerprint}). The `
        + 'note exists to say WHICH key was observed signing; without that it records only that '
        + 'something happened. Re-run verify-release-key.sh rather than editing the file.');
    assert.ok(/^[0-9A-F]{16,}$/.test(String(keyPin.signingSubkey || '')),
        `FAIL: ${keyPinPath} does not record the subkey that actually made the signature `
        + `(${keyPin.signingSubkey}). The release identity's primary is certify-only, so the key a `
        + 'user checks and the key that signs are different values, and a note holding only one of '
        + 'them cannot be compared against a published trust root.');

    // AND THE CROSS-CHECK NOTHING ELSE MAKES. release-key-pin.smoke.js
    // compares the two PUBLISHED channels (SECURITY.md and xchain.io/security)
    // against each other and against the desktop updater's pin. All three are
    // transcriptions of the same documented value, so they can agree perfectly
    // and still name a key that has never signed anything. This is the only
    // place a published trust root meets the key that actually signs.
    //
    // It is deliberately conditional: the fingerprint is unpublished today
    // (pre-launch, and correctly so), and this is not the channel to publish
    // it on. The day it is published, this compares.
    const security = readFileSync(join(walletRoot, 'SECURITY.md'), 'utf8');
    const published = security.match(/PGP fingerprint:\s*`?([0-9A-Fa-f]{40})`?/);
    if (published) {
        assert.equal(published[1].toUpperCase(), keyPin.fingerprint.toUpperCase(),
            'FAIL: SECURITY.md publishes a release-key fingerprint that is NOT the key observed '
            + `signing.\n  published as the trust root: ${published[1].toUpperCase()}\n`
            + `  observed signing (${keyPin.observedAt}): ${keyPin.fingerprint}\n`
            + '  Users verify downloads against the published value, so a mismatch means every '
            + 'signature check fails for everyone, or worse, succeeds against the wrong key.');
    }
}

// --- 17. The ceremony has to know WHICH build it is uploading -------------
//
// Row 38. The wallet builds at two profiles and they differ in which surfaces
// exist. Measured 2026-08-06 against the real v0.336.0 release zip:
// `XCHAIN_BUILD_PROFILE: store` appears exactly once in release.yml, on the
// mobile lane, so the artifact bound for the Chrome Web Store is a `default`
// build carrying the DEX surfaces  compiles out of a store build - and
// it carried no stamp saying so, while the web shell has stamped its own
// bundle since .
//
// The step is worth checking rather than trusting because of WHEN it runs:
// Chrome assigns a permanent extension ID to whatever is uploaded first, and
// "which build was that" is not a question anyone can answer later from a
// workflow file that has since moved on.
//
// This asserts the step exists and reads the stamp from the ARTIFACT. It
// deliberately does NOT assert which profile is correct: that is an operator
// decision (2026-08-06: `default`), and a gate that pinned it would have to be
// edited by the same change that revisits it, which is how a check comes to
// rubber-stamp whatever it is pointed at.
const profileSteps = phase4.split('\n').filter((l) => /build-profile\.txt/.test(l));
assert.ok(profileSteps.length >= 1,
    'FAIL: Phase 4 never tells the operator to record which build profile is being uploaded. The wallet '
    + 'builds at two profiles that differ in which surfaces exist, the mobile lane uses `store` and this '
    + 'lane uses `default`, and the store binds a permanent extension ID to the first upload. The step '
    + 'must read the stamp out of the artifact (unzip -p ... build-profile.txt).');

// The stamp has to be read from the ZIP, not from a build directory. This is
// S28's row 23 exactly: `packages/extension/dist` is gitignored and is
// whatever the shared worktree last built, so a step pointed there would
// certify a profile the uploaded bytes never had.
const profileWindow = phase4.slice(phase4.indexOf(profileSteps[0]) - 400);
assert.ok(/unzip[^\n]*\.zip[^\n]*build-profile\.txt|unzip -p[^\n]*release-artifacts/.test(profileWindow),
    'FAIL: the build-profile step does not read the stamp out of the release ZIP. Reading it from a build '
    + 'directory certifies whatever this machine last built rather than the bytes being uploaded, which is '
    + 'the defect §12 already fixed once for the remote-code audit.');

// And the absent case has to be called unknown rather than default, which is
// the one thing the stamp's own helper insists on: an unstamped bundle is one
// whose profile nobody recorded, not one built without flags.
assert.ok(/absent stamp[^\n]*not the same as|treat it as unknown/i.test(phase4),
    'FAIL: Phase 4 does not say what an ABSENT build-profile stamp means. Reading a missing stamp as '
    + '`default` is the assumption the mechanism exists to prevent: an unstamped bundle is one whose '
    + 'profile nobody recorded. Every release before this step landed is unstamped.');

// --- 18. The command the ceremony hands you must reach the ceremony's own
//         staging path ---------------------------------------------------
//
// §12 caught a linked command that ran, exited 0 and audited the wrong
// artifact. This is the same class one step earlier: a linked command that
// cannot reach the artifact AT ALL, and whose failure reads as "the release
// was never staged" rather than "the shorthand is wrong".
//
// Phase 4a checks `release-artifacts/vX.Y.Z/`, and that is where the release
// procedure stages a set. `pnpm release:sign` resolved to
// `release-artifacts/<version>` - the `v` on the tag and missing from the
// path - so the documented shorthand pointed at a directory that has never
// existed for any release. An operator meeting that mid-ceremony sees
// sign.sh say the input dir does not exist and has no reason to doubt the
// command; the natural next move is to re-stage, or to pass the path by hand
// and get it subtly wrong.
//
// The assertion is deliberately about AGREEMENT rather than about a literal:
// the point is that the ceremony page and the package script cannot drift
// into two different answers about where a release lives, which is this
// spec's oldest recurring defect in its smallest form.
const pkg = JSON.parse(readFileSync(join(walletRoot, 'package.json'), 'utf8'));
const ceremonyStagePaths = [...ceremony.matchAll(/release-artifacts\/(v?)X\.Y\.Z/g)]
    .map((m) => m[1]);
assert.ok(ceremonyStagePaths.length > 0,
    'FAIL: the ceremony page no longer names release-artifacts/vX.Y.Z, so Phase 4 has stopped '
    + 'saying where the artifact it hash-checks comes from.');
assert.ok(ceremonyStagePaths.every((prefix) => prefix === 'v'),
    'FAIL: the ceremony page spells the staging directory both ways. Phase 4a and the release '
    + 'procedure must agree on one, or the operator hash-checks a directory the release was not '
    + 'staged into.');

for (const script of ['release:sign', 'release:verify']) {
    const cmd = pkg.scripts?.[script];
    assert.ok(typeof cmd === 'string' && cmd.length > 0,
        `FAIL: package.json has no ${script} script, and the ceremony's Phase 4 is written around `
        + 'the release procedure that uses it.');
    const input = cmd.match(/--input\s+(\S+)/);
    assert.ok(input,
        `FAIL: ${script} passes no --input, so it cannot be the command that operates on the `
        + 'staged release the ceremony checks.');
    assert.ok(/^release-artifacts\/v/.test(input[1]),
        `FAIL: ${script} targets '${input[1]}', which is not the release-artifacts/vX.Y.Z path the `
        + 'ceremony page hash-checks in Phase 4a. The v belongs on both or on neither; today the '
        + 'tag carries it, the ceremony carries it, and this script does not, so the documented '
        + 'shorthand resolves to a directory no release has ever been staged into.');
}

console.log(`OK: extension ceremony-collateral smoke (operator ruling 2026-08-03, one home: `
    + `${steps} checkable steps + ${commandBlocks} fenced blocks on the ceremony page, `
    + `${disclosureSteps} on the disclosure, ${PUBLISHED.length} identity values traced to `
    + `privacy/trader-identity.md, ${extensionHosts.length} egress hosts from wireAudit.js, `
    + `${citations} cited wallet-repo paths resolved across the repo boundary, `
    + `${placeholderSteps.length} cross-page placeholder step verified, ${pointerNote}; `
    + `the published policy matches the canonical one, ${monitorSteps.length} monitor steps `
    + `including a checksum identity check, Phase 4's key-ceremony state anchored to `
    + `${existsSync(keyPinPath) ? 'an observed signing run' : 'its absent-note branch'}, `
    + `and ${driftNote}; the release shorthand reaches the ceremony's own staging path)`);
