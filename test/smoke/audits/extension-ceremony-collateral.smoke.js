// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Chrome submission ceremony is an OPERATIONAL checklist, and this holds it
// to the two things that make it one: the values it tells an operator to paste,
// and the fact that it is checkable at all.
//
// Operator ruling 2026-08-03: ceremonies are documentation and documentation
// has ONE home, the xchain-documentation repo. So this gate does not prove a
// second copy exists here, it proves the one copy over there did not get
// de-operationalized. The port that prompted it rendered the ceremony as
// evergreen prose carrying 0 of the runbook's 40 checkable steps, 0 of its 8
// fenced command blocks, and none of the public identity values.
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
// The tool is the only thing here that can see what is PUBLISHED, so §14 uses
// its own fingerprint functions rather than a second opinion about what "the
// same policy" means. DEFAULT_URL is aliased because §10 already binds that
// name from a dynamic import, and a duplicate top-level binding is a
// parse-time SyntaxError that kills the whole file rather than one section.
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

// 1. The ceremony has to be executable.
//
// The floors are the counts folded into the page on 2026-08-03, and they are
// floors rather than equalities so the page may grow. A future scrub that turns
// steps back into paragraphs, or describes a command instead of giving it, must
// fail here; if the ceremony genuinely shrinks, lower the floor in the same
// change and say why.

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

// 2. The identity values, read from the record and never restated.

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
// to be transcribed: absence is the failure guarded, so presence is asserted
// rather than "no contradiction". These four values appear on the listing.
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

// 3. The disclosure still derives from the code.

const extensionHosts = egressHostsFor('extension').filter((h) => h !== '*');

for (const host of extensionHosts) {
    assert.ok(disclosure.includes(host),
        `privacy/data-disclosure.md does not name ${host}, which wireAudit.js says the extension `
        + 'contacts. The data-disclosure tab is answered from that page, and an egress the console form '
        + 'does not declare is exactly the policy-versus-disclosure mismatch that gets a wallet listing '
        + 'rejected.');
}

// 4. Every WALLET-REPO path the ceremony cites has to resolve.
//
// A rename in tools/release/ sends the operator to a dead command mid-ceremony,
// on a review clock, in a procedure with irreversible steps. The docs repo
// tests its own internal links and cannot see this tree, so this gate is the
// only place that reads both. One-directional on purpose: a path with no
// citation is fine, only a citation with no path is a failure.

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

// 5. The private pointers the public page is forbidden to carry.
//
// The docs standard bars internal paths, item ids and store identities from
// published pages and names the spec as their home. When the migration stripped
// them from the ceremony page, nothing picked them up, so for a day the page
// told an operator to log a rejection "in the correspondence log" while no
// document said where that log was, on a clock that can be seven days.
//
// THE S14 LESSON, which sections below reuse by name: a check that fires on
// correct writing is one people delete. So this is scoped hard to the spec's
// §4a block, because the spec deliberately names long-deleted files in its
// superseded rows.
//
// SPECS_DIR and PLATFORM_ROOT come from the shared module rather than being
// re-derived from `walletRoot/..`: with `XCHAIN_PLATFORM_ROOT` overridden the
// two derivations disagreed, and the gate went red accusing the frontier of
// citing paths that were all fine.
const specPath = join(SPECS_DIR, 'wallet-publishing-chrome-extension.md');
let pointers = 0;

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const start = spec.indexOf('## 4a. The private pointers');
    assert.ok(start !== -1,
        'the spec no longer has a "## 4a. The private pointers" block. That block is where the'
        + 'docs standard puts the operator map the published ceremony page is forbidden to carry: the '
        + 'correspondence log, the incident runbook, the K7 custody row. If it moved, repoint this '
        + 'gate in the same change; if it was deleted, the operator has no map on a rejection clock.');

    const end = spec.indexOf('\n## ', start + 1);
    const block = spec.slice(start, end === -1 ? undefined : end);
    const missing = [];

    for (const m of block.matchAll(/`(claude\/[A-Za-z0-9_./-]+)`/g)) {
        pointers += 1;
        if (!existsSync(join(PLATFORM_ROOT, m[1]))) missing.push(m[1]);
    }

    assert.equal(missing.length, 0,
        `the spec's §4a private-pointer map names paths that do not exist:\n`
        + `${missing.join('\n  ')}\n`
        + 'This block exists because the published ceremony page cannot name these, so it is the only '
        + 'place an operator can find them. It named a correspondence log deleted three days earlier '
        + 'until 2026-08-03.');

    assert.ok(pointers >= 3,
        `§4a lists ${pointers} private pointers, fewer than the three it was written with (the `
        + 'correspondence log, the incident runbook, the K7 custody row). A map that loses an entry '
        + 'is how the migration lost them all in the first place.');
}

// 6. The frontier's LIVE rows have to name artifacts that exist.
//
// Section 5 one level up: §4a is held to being a live map, the frontier table
// above it was not, and the frontier is what an operator reads to learn what is
// left. It rotted twice in two stages, the second time on row 1, the row that
// IS the goal. Only LIVE rows are held to naming live things (§5's S14
// scoping): a row is live when its Item cell is neither struck through (~~...~~)
// nor a parenthesised superseded copy.

const frontierRows = [];
let goalRow = null;

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const fStart = spec.indexOf('<!-- BUILD-SPEC:FRONTIER');
    const fEnd = spec.indexOf('<!-- /BUILD-SPEC:FRONTIER', fStart + 1);
    assert.ok(fStart !== -1 && fEnd > fStart,
        'the spec has no BUILD-SPEC:FRONTIER block. That block is the spec\'s own record of'
        + 'what is left and who owns each row; without it the goal state lives nowhere.');

    for (const line of spec.slice(fStart, fEnd).split('\n')) {
        if (!line.startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 5) continue;
        const [id, item, , state] = cells;
        if (!/^\d/.test(id)) continue;                       // header and separator
        if (item.startsWith('~~') || item.startsWith('(')) continue;   // closed / superseded copy
        if (/^(DONE|note)/i.test(state)) continue;
        // The Item cell is what the row tells somebody to go and do; the
        // Evidence cell legitimately names dead files in order to say they
        // died, so holding the narrative to the subject's rule fires on
        // correct writing (§5's S14 lesson), as the first cut of this did.
        frontierRows.push({ id, line, item });
        if (id === '1') goalRow = item;
    }

    // 6a. The goal row names the ceremony that exists, not one of the four
    // wallet-repo documents the one-home ruling deleted. Derived from this
    // gate's own CEREMONY constant, so a future move repoints both together.
    assert.ok(goalRow,
        'the frontier has no live row 1. Row 1 is the console ceremony, which IS the goal of'
        + 'this spec; if it closed, the goal is reached and the spec should say so.');

    const ceremonyDoc = CEREMONY[CEREMONY.length - 1];
    assert.ok(goalRow.includes(ceremonyDoc),
        `the frontier's goal row does not name ${ceremonyDoc}, the document that actually`
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
        `the frontier's goal row does not say "${range}", which is the phase range the ceremony`
        + `page actually carries (${phases.length} phase headings). It said "Phases 1-8" while the `
        + 'page began at Phase 0: Preconditions, so the row understated the ceremony by a whole phase.');

    // 6c. Anything a live row cites has to resolve, in whichever tree owns it.
    // A packages//tools//test/ path is not necessarily this repo's: the release
    // story spans sibling checkouts, and resolving against the wallet tree
    // alone reports live files as dead (three of the S24 sweep's five hits).
    // Parsing and resolution live in _spec-frontier.js because the same rot was
    // live in the desktop and android specs; this block keeps only the
    // chrome-specific failure message.
    const dead = [];
    for (const { id, line } of frontierRows) {
        for (const cited of citationsIn(line).paths) {
            if (!resolveCitation(cited).ok) dead.push(`row ${id} cites ${cited}`);
        }
    }

    assert.equal(dead.length, 0,
        `live rows of the frontier cite paths that do not exist:\n ${dead.join('\n ')}\n`
        + 'The frontier is what a later stage, or the operator, reads to find out what is left. A live '
        + 'row pointing at a deleted file is how two stages in a row lost the thing they were about.');
}

// 7. The pre-migration translation map has to translate.
//
// Rather than rewrite every citation in a history-bearing spec, §32 states a
// rule ("read a pre-migration path as the new home") and a map. The map is then
// the only route from old text to a live deliverable, so a stale map breaks
// every old citation at once; it had already lost both declarations of record,
// cited ten times, when this was written. Left-hand sides are deliberately not
// resolved (they are supposed to be dead); only the new homes must exist.

let mapEntries = 0;

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const start = spec.indexOf('**Reading older text in this spec**');
    assert.ok(start !== -1,
        'the spec no longer has its "Reading older text in this spec" block. That block is the'
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
        `the spec's pre-migration translation map points at docs-repo pages that do not`
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

// 8. A step that says "go edit that page" has to find it there.
//
// Sections 4 and 6 prove a cited file EXISTS; this is the layer they cannot
// see. Phase 6 tells the operator to record the store-assigned extension ID
// "wherever [the bridge page] documents chrome-extension://<id>/...", and
// measured 2026-08-03 that page contained no occurrence of it: the port had
// genericized the sentence, so the link stayed fine while its destination moved
// on. The worst step in the ceremony to leave aimed at nothing, since it runs
// in the minutes after first upload and the ID is assigned once, permanently.
// Scoped to checkable steps that both link a page and name a placeholder in
// backticks (§5's S14).

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

// 10. The value the store form validates has a real source.
//
// Section 8's defect on the only field the Chrome Web Store form validates.
// Phase 3 said to take the canonical URL from the wallet's privacy policy "so
// there is only ever one copy of it", and privacy-policy.md has never contained
// that URL, so the operator retypes from memory, which is how the slashless
// form gets pasted two paragraphs after Phase 3 warns a redirect hop is a
// rejection cause. The fix stopped sourcing it from a document: the Phase 3
// check prints the URL, so the string verified live and the string pasted are
// the same one. Held from both ends, importing the constant and DRIVING the
// tool, because "it prints the URL" is the kind of claim this spec keeps
// finding to be false.

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

// Positively: the page must tell the operator the check's own output is where
// the value comes from. Otherwise a ceremony that says nothing about the URL
// satisfies this section, and saying nothing is how the operator retypes it.
const ceremonyLines = ceremony.split('\n');
assert.ok(ceremonyLines.some((l) => /canonical URL/i.test(l) && l.includes('`url:')),
    'no line of the ceremony points the operator at the `url:` line the Phase 3 check prints as the '
    + 'source of the canonical policy URL. That arrangement is the whole fix: the string verified live '
    + 'and the string pasted into the console are then the same one. If the source moved, move this '
    + 'assertion with it, in the same change.');

// Negatively: no line may go back to sourcing the value from a page that does
// not carry it. Scoped to an explicit sourcing instruction aimed at a linked
// page, not to any mention of the URL beside a link: the looser first cut fired
// on a sentence that merely described provenance (§5's S14).
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

// 11. A step's linked procedure must not contradict the step.
//
// Sections 8 and 10's class at its sharpest: the link resolved, the page
// existed, and its contents told the operator to do the thing the step forbids.
// Phase 8's exit criterion requires connect and sign driven "from the
// store-installed build specifically", and linked a runbook that opens with
// "Load unpacked", so an operator following it ticked a public-flip criterion
// having proved nothing about the shipped artifact. The rule is therefore not
// "the link resolves" but "the linked SECTION covers what the step asks for",
// derived from the step's own words.

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

// 12. A command can resolve, run, exit 0, and measure the wrong thing.
//
// Sections 8, 10 and 11 ask what a linked PAGE says; this asks it of a linked
// COMMAND, where a wrong measurement still exits 0 and prints a verdict. Driven
// 2026-08-04, the disclosure's `remote-code-audit.mjs` step reported the
// shipped bundle clean having defaulted to packages/extension/dist: gitignored,
// two days stale, built from whatever the shared worktree held, while the
// build-provenance phase refuses a locally built zip for upload. Both ends are
// held here, and the script's half is DRIVEN rather than read, because "it
// accepts a directory" is the kind of claim that rots silently.

// Escapes every regex metacharacter (not just '.') so a literal string can
// be embedded in `new RegExp()` without a stray backslash in the input
// changing how the following character is interpreted.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AUDIT = 'packages/extension/scripts/remote-code-audit.mjs';
const auditSteps = disclosure.split('\n').filter((l) => /^[⬜✅]/.test(l) && /remote.code audit/i.test(l));

assert.equal(auditSteps.length, 1,
    `the disclosure carries ${auditSteps.length} checkable steps about the remote-code audit, expected 1. `
    + 'That step is what turns the store form\'s permanent remote-code answer into a measurement; if it '
    + 'was split or retired, update this section in the same change.');

// The command block under that step has to name the audit AND give it a target.
const auditBlock = disclosure.slice(disclosure.indexOf(auditSteps[0]));
const auditCmd = auditBlock.match(new RegExp(`node\\s+${escapeRegExp(AUDIT)}([^\\n]*)`));
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

// 13. Every release script answers --help, and answers ONLY --help.
//
// Not a style rule. `--help` is what people type when a command refuses them,
// which is when a release ceremony is already going badly, and on 2026-08-04
// four tools answered it with their own failure vocabulary, one of them
// announcing "RELEASE GATE REFUSED" to somebody who only asked how to invoke it.
//
// (a) THE SUBJECT IS THE DIRECTORY, NOT THE PAGES. Harvesting tool names out of
//     the ceremony pages covered only the Chrome subset, left nine mobile and
//     desktop scripts with no --help handling, and read a repo that is this
//     one's PARENT, so the venue that gates a push harvested one tool fewer and
//     still cleared its floor. A check whose subject the venue does not check
//     out is not a check in that venue. The pages are still read for the one
//     thing a directory scan cannot say: that nothing the ceremony hands an
//     operator lives outside the scanned directories.
//
// (b) EXIT 0 IS NOT THE PROPERTY. It is satisfied by the worst behaviour in
//     this class: capture-listing-screenshots.mjs ran the FULL capture and
//     overwrote three of the four store listing assets, exit 0 because the work
//     succeeded; capture-update-check.mjs overwrote the capture the download
//     page is checked against; emulation-preflight.sh took --help as its Docker
//     platform positional; rehearsal-matrix.mjs printed nothing at all. An
//     unrecognized flag is not ignored, it is CONSUMED, so three properties are
//     required and each rules one of those out: exit 0, real usage on stdout,
//     and an unchanged worktree measured with `git status --porcelain` around
//     each run.
//
//     That last property reads the shared worktree, so a neighbouring session
//     writing during the sub-second window a script runs in surfaces as a false
//     red naming that file. Loud rather than silent, and deterministic on the
//     CI venue, which is a clean checkout with one writer.

const toolRe = /(tools\/release\/[a-z0-9-]+\.(?:mjs|sh)|packages\/extension\/scripts\/[a-z0-9-]+\.(?:mjs|sh))/g;

// Recursive on purpose: `tools/release/drills/` holds deb-update-swap.mjs,
// whose one positional is a directory it INSTALLS SYSTEM PACKAGES from, and a
// non-recursive scan left the most side-effecting script in the tree uncovered.
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

// The floor is 29: the scripts COMMITTED at HEAD on 2026-08-04, counted from
// `git ls-files` rather than the worktree, because the venue gates the
// committed tree and a floor taken from uncommitted neighbours goes red on
// every clean checkout. A floor rather than an equality so the directories may
// grow; a shrink means a tool was deleted (lower this and say why) or the scan
// broke (the previous cut proved a broken scan reports OK while checking less).
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
    // Anchored to a line start so `usage:` mid-sentence does not count, but
    // tolerant of a comment prefix: the bash tools print their own header block
    // verbatim, so their usage line arrives as `# Usage:`.
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

// 13b. A help screen may not be extracted by absolute line number.
//
// The three properties above are all satisfied by a help screen that is
// SILENTLY TRUNCATED, which is the shape this class actually fails in:
// android-ceremony.sh printed its usage with `sed -n '17,50p'`, and the
// header grew underneath it until the slice started one line below the
// title and stopped ON the heading "THE TWO KEYS ARE NOT INTERCHANGEABLE:",
// dropping the paragraph saying K10 cannot be rotated and that losing it
// costs every direct-download user their vault. Exit 0, a Usage: line, the
// tool's own name and forty lines of output - all four held the whole time.
// The house form is content-bounded (sign.sh: "bounded by content, not by
// line numbers - those drifted and printed the licence"), and this is the
// only thing that keeps the next author from reaching for the slice again.
{
    const SLICE = /sed\s+-n\s+'\d+,\d+p'/;
    const sliced = releaseScripts.filter(
        (t) => SLICE.test(readFileSync(join(walletRoot, t), 'utf8')),
    );
    assert.deepEqual(sliced, [],
        `${sliced.join(', ')} extract help text by absolute line number. That slice cannot know when `
        + 'the comment block above it grows, so it silently truncates - and every property this '
        + 'section already checks stays green while it does. Use the content-bounded form the rest of '
        + "tools/release/ uses: awk '/^#\\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} "
        + "seen>=2{print}' \"$0\".");

    // And the specific sentence that went missing, because a general rule
    // about extraction says nothing about whether the text survived.
    const ceremonyHelp = execFileSync('bash',
        [join(walletRoot, 'tools/release/android-ceremony.sh'), '--help'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(ceremonyHelp, /THE TWO KEYS ARE NOT INTERCHANGEABLE:/,
        'android-ceremony.sh --help no longer carries the two-key heading.');
    assert.match(ceremonyHelp, /reinstall across a trust break/,
        'android-ceremony.sh --help prints the "the two keys are not interchangeable" heading and '
        + 'then stops before the K10 paragraph it introduces. The operator asking how to invoke the '
        + 'signing ceremony is the operator holding both keys, and the unrotatable one is the whole '
        + 'reason that heading is there.');
    assert.match(ceremonyHelp, /android-ceremony\.sh - build AND sign/,
        'android-ceremony.sh --help does not begin with the line that says what the tool is.');
}

// 9. Every stage the frontier names has a row in the stage table.
//
// Bookkeeping, gated because by hand it failed three times in four stages: the
// person who forgets the row is the one who would have to remember to check for
// it. §9 is the only account of a stage a reader who skipped the frontier
// finds, so a frontier citing "S25" against a table with no S25 argues with
// itself.

if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');
    const open = spec.indexOf('<!-- BUILD-SPEC:FRONTIER');
    const close = spec.indexOf('<!-- /BUILD-SPEC:FRONTIER');
    assert.ok(open !== -1 && close > open,
        'the spec has no delimited BUILD-SPEC:FRONTIER block any more. That block is the one'
        + 'place the goal\'s own state is tracked, deliberately in the spec rather than in a sidecar '
        + 'so it cannot drift from it. If it was renamed, repoint this gate in the same change.');

    const frontier = spec.slice(open, close);
    const named = [...new Set([...frontier.matchAll(/\bS(\d{1,2})\b/g)].map((m) => Number(m[1])))];
    const rows = new Set([...spec.matchAll(/^\| S(\d{1,2}) \|/gm)].map((m) => Number(m[1])));

    assert.ok(named.length >= 1,
        'no build stage is named anywhere in the frontier block. Every stage since S19 has'
        + 'reasoned from what an earlier one measured; a frontier that names none has lost the record '
        + 'this spec argues from. This check must not pass vacuously on zero.');

    const unlisted = named.filter((n) => !rows.has(n)).sort((a, b) => a - b);
    assert.equal(unlisted.length, 0,
        `the frontier reasons from stages that §9's stage table has no row for:`
        + `${unlisted.map((n) => `S${n}`).join(', ')}. §9 is the model/effort plan the staged-build `
        + 'protocol reads at a stage boundary, and the only account of a stage a reader who skipped the '
        + 'frontier will find. Add the row in the same change as the frontier edit, the way S24 had to '
        + 'add S23\'s and S26 had to add S25\'s.');

    // The same rot one paragraph higher: the headline `**Status:` was fixed by
    // hand after two stages stale and went stale again the same day. It is the
    // first thing anyone reads. The live paragraph is the FIRST `**Status:` in
    // the file, the superseded ones being labelled `**Superseded status`, which
    // is what makes this derivable at all.
    const statusAt = spec.indexOf('**Status:');
    assert.ok(statusAt !== -1,
        'the spec has no `**Status:` paragraph. It is the dated, stage-labelled headline a'
        + 'reader meets before anything else; the convention exists because an undated one read as '
        + 'current for two stages while being two stages wrong.');

    const stageInStatus = spec.slice(statusAt, statusAt + 400).match(/after S(\d{1,2})\b/);
    assert.ok(stageInStatus,
        'the spec\'s headline `**Status:` paragraph no longer says which stage it is current as'
        + 'of. "after S<n>" is what makes it checkable; without it, staleness is invisible again.');

    const latest = Math.max(...named);
    assert.equal(Number(stageInStatus[1]), latest,
        `the spec's headline status paragraph says it is current after S${stageInStatus[1]}, but`
        + `the frontier below it reasons as far as S${latest}. That paragraph is the first thing a `
        + 'reader meets and the last thing a stage remembers to update: S24 fixed it by hand after it '
        + 'had been two stages stale, and S25 left it stale again the same day.');

    // A floor of the 26 rows standing after S26, so the table may grow and a
    // scrub that empties it cannot pass this section by leaving the frontier
    // naming nothing.
    assert.ok(rows.size >= 26,
        `§9's stage table carries ${rows.size} stage rows, fewer than the 26 standing after S26. A `
        + 'stage row is the record of what a stage did; deleting one loses that permanently, since the '
        + 'reports directory holds a report for only some stages.');
}

// The absent branch names §9 too: it reads the same spec as §§5-7 and used to
// degrade to nothing with the output saying so nowhere, and a summary that
// reports only the sections announcing their own skip is how a partial run
// reads as a full one. §13 is not on that list because its subject is two
// directories in THIS repo, so it reports the same number everywhere.
const toolNote = `${releaseScripts.length} release scripts answer --help with usage, exit 0 and no `
    + `side effects (${pageTools.length} of them named on the ceremony pages)`;

const pointerNote = existsSync(specPath)
    ? `${pointers} §4a private pointers resolved, ${frontierRows.length} live frontier rows verified, `
        + `${mapEntries} translation-map pages resolved, ${toolNote}`
    : `${toolNote}; the §4a map, the frontier rows, the translation map, the §9 stage table and `
        + '§24\'s URL-canonicalisation check all SKIPPED (platform checkout absent, as on every CI '
        + 'run: it is this repo\'s parent, not a sibling)';

// 14. The policy the store validates is PUBLISHED, not merely written.
//
// THE OBVIOUS CHECK IS THE WRONG ONE. Comparing the working tree against
// origin/master goes green the moment the editing lane COMMITS, which is
// exactly the state where the gap is real and unattended: written, pushed, not
// deployed. Git can only see what WOULD be published.
//
// So the subject is the DEPLOY and the anchor is docs/privacy-deploy-pin.json,
// which verify-privacy-url.mjs writes only on a confirmed live observation.
// This goes red the moment the canonical text moves and stays red until someone
// redeploys and re-runs the tool. Prose addressed to whoever edits the policy
// failed four times; the lane that edited it on 2026-08-05 had never read this
// spec, and a rule that depends on its reader having read it is not a mechanism.
const policyMarkdown = readDoc('privacy', 'privacy-policy.md');
const canonicalFingerprint = policyFingerprint(policyTextFromMarkdown(policyMarkdown));

// Venue drift, declared rather than asserted: editing a docs page before
// committing is legitimate, but a check that degrades quietly still prints a
// verdict, so local-green and CI-green must be distinguishable from the output.
// The subject is the whole wallet docs tree, because a list of pages rots.
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

// The assertion below used to compare the hash and only PRINT the URL, so a pin
// recorded at any address satisfied it: a pin with the right policy hash and
// the URL `https://staging.internal/policy/` passed the previous cut. Not
// hypothetical, since --url exists and is meant to be used, and a staging run
// writes an honest pin that silently retires the evidence about the address the
// store form validates. Checked BEFORE the hash, because a pin from elsewhere
// makes the hash comparison meaningless rather than merely incomplete.
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

// 15. Arming the monitor has to check IDENTITY, not just presence.
//
// The rogue-publish monitor is the security control for a compromised publisher
// account, and it lives on a host no test can reach. Three stages "verified" its
// row by measuring only that a file EXISTS at the install path; measured
// 2026-08-05, the installed copy and the repo copy had already diverged. That is
// §8's rule aimed at a deployed BINARY: a citation has an address and contents,
// and a monitor that is the wrong version is read by nobody.
//
// A CEREMONY STEP RATHER THAN A CONTINUOUS CHECK, deliberately: the suite cannot
// reach the host, the pin pattern would need a new tool holding SSH credentials,
// and the drift cannot matter until arming, which happens once by hand in Phase
// 8. The published page says "the installed copy" and never a hostname (§5).
const monitorSteps = ceremony.split('\n').filter((l) => /store-version-monitor/.test(l));
assert.ok(monitorSteps.length >= 2,
    'FAIL: the ceremony describes the store-version monitor in fewer than two steps. Arming it '
    + 'asks two separate questions (is the JOB running, and is the INSTALLED SCRIPT the reviewed '
    + 'one) and they are easy to collapse into one. Row 31 exists because only the first was ever '
    + `asked. Found ${monitorSteps.length} step(s).`);

// A THIRD question, from another lane: the same script carries a Play lane armed
// with `--no-chrome`, so a crontab can show store-version-monitor.mjs scheduled
// and firing while no Chrome item is watched. The "is the JOB running" box is a
// §4 public-flip exit criterion satisfied by that entry, so it must name what
// distinguishes the Chrome job, which is the item id.
const liveStep = monitorSteps.find((l) => /store-version monitor is live/i.test(l));
assert.ok(liveStep, 'FAIL: no "the store-version monitor is live" step on the ceremony page');
assert.ok(/CWS_MAIN_ITEM_ID/.test(liveStep) && /--no-chrome/.test(liveStep),
    'FAIL: the monitor-is-live box does not say which scheduled job satisfies it. Since the Play '
    + 'lane arms the SAME script with --no-chrome, a job matching this script can be installed and '
    + 'firing while nothing watches the Chrome item, and this box is a §4 public-flip exit '
    + 'criterion. It must identify the Chrome job by CWS_MAIN_ITEM_ID and say that a --no-chrome '
    + 'entry is the Play lane and does not count.');

// The same exit criterion is written down TWICE and both copies are ticked by
// the same person, the mirror being release/qa-checklist.md. Fixing one of two
// mirrored checklists is a repair scoped to where the problem WAS rather than
// where it travels, so the discriminator is required in both.
const qaProvenance = readDoc('release', 'qa-checklist.md')
    .split('\n').find((l) => /Store-version monitor is live/i.test(l));
assert.ok(qaProvenance,
    'FAIL: release/qa-checklist.md no longer carries the "Store-version monitor is live" row that '
    + 'the ceremony cites as the one-time setup steps for this box.');
assert.ok(/CWS_MAIN_ITEM_ID/.test(qaProvenance) && /--no-chrome/.test(qaProvenance),
    'FAIL: the QA checklist mirror of the monitor-is-live exit criterion does not distinguish the '
    + 'Chrome job from the Play lane, which arms the SAME script with --no-chrome. The ceremony '
    + 'page carries that distinction and this copy does not, so whichever list the operator ticks '
    + 'from decides whether the trap is visible.');

const identityStep = monitorSteps.find((l) => /sha256/i.test(l));
assert.ok(identityStep,
    'FAIL: no step tells the operator to compare the INSTALLED monitor against the reviewed one by '
    + 'checksum. Measured 2026-08-05: the installed copy and the repo copy had already diverged, '
    + 'and every earlier verification of that row checked only that a file existed at the path. A '
    + 'file at the right path is not evidence that it is the right file.');

// The comparison needs a SUBJECT, as a COMMAND. The first cut accepted the words
// "release tag" appearing nearby, and a mutation deleting the actual comparison
// still passed, because the prose underneath says "reinstall from the release
// tag". So both halves must be runnable: a hash of the installed file, and one
// taken from the release tag rather than the working tree, which holds anything.
const identityWindow = ceremony.slice(ceremony.indexOf(identityStep))
    .split('\n').slice(0, 14).join('\n');
assert.ok(/git show[^\n]*store-version-monitor[^\n]*sha256sum/.test(identityWindow),
    'FAIL: the checksum step never says what the installed copy must MATCH, as a command. A hash '
    + 'with nothing to compare it against is a number, not a check, and prose naming the release '
    + 'tag is not a comparison. The step needs the second hash taken from the tag itself '
    + '(git show <release-tag>:tools/release/store-version-monitor.mjs | sha256sum).');

// 16. A BLOCKER the page states has to be anchored to the thing that clears it.
//
// §14 generalized: for any fact whose subject lives outside this repo, git
// cannot see it, so a document depending on that fact hardcodes it and the
// hardcoded fact rots. The release signing key is one. Measured 2026-08-06, the
// key ceremony had run the previous evening while Phase 4 still said the phase
// could not be completed until it did.
//
// THAT DIRECTION IS THE WORSE ONE: other instances make unfinished work look
// finished, while a stale BLOCKER makes available work look impossible and
// survives longer because nobody re-measures a blocker. So the page may assert
// neither state; it is held to docs/release-key-pin.json, and the EMPTY state is
// checked as strictly as the filled one, since a guard that starts working only
// after the event it guards is not a guard.
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
    // No note means nobody has proved the key signs here, and the page must say
    // so: the alternative is an operator uploading a zip with no signed manifest
    // behind it, and the first upload is what the store binds the ID to.
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

    // The cross-check nothing else makes. release-key-pin.smoke.js compares the
    // published channels against each other and against the desktop updater's
    // pin, but all three transcribe the same documented value, so they can agree
    // perfectly and still name a key that has never signed anything. Conditional
    // because the fingerprint is unpublished pre-launch; the day it is
    // published, this compares.
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

// 16b. Phase 4b has to check WHICH KEY signed, not that a signature was good.
//
// Section 16's other half. Nothing held the page to checking that the manifest
// about to be uploaded was signed by the key the note records, because verify.sh
// ran a bare `gpg --verify`, which answers whether somebody in your keyring
// signed it. Found by rehearsing the phase against the real CI-built extension
// zip: the manifest was signed with the TAG-SIGNING key and Phase 4b reported
// `ok`. Both halves are asserted, because either alone rots.
const verifySh = readFileSync(join(walletRoot, 'tools', 'release', 'verify.sh'), 'utf8');
assert.ok(/signer ok/.test(verifySh) && /VALIDSIG/.test(verifySh),
    'FAIL: tools/release/verify.sh no longer attributes the signature to a key (no VALIDSIG '
    + 'comparison, no `signer ok` line). Phase 4b of the ceremony is the only signature check '
    + 'between the store-bound zip and a permanent listing, and a bare `gpg --verify` answers '
    + 'whether somebody in the operator\'s keyring signed the manifest, never whether the '
    + 'release key did. On the release machine, which holds three keys by design, those are '
    + 'different questions with the same green answer.');
assert.ok(/signer ok/.test(phase4),
    'FAIL: Phase 4 no longer tells the operator to check WHICH key signed the manifest. The step '
    + 'must require the `signer ok - <fingerprint>` line and say that fingerprint is the release '
    + 'key\'s; "the signature is OK" was true of a manifest signed with the tag-signing key for '
    + 'as long as this phase existed.');

// 17. The ceremony has to know WHICH build it is uploading.
//
// The wallet builds at two profiles that differ in which surfaces exist.
// Measured 2026-08-06 against the real v0.336.0 zip, the artifact bound for the
// Chrome Web Store was a `default` build carrying the DEX surfaces a store build
// compiles out, and it carried no stamp saying so. Worth checking because of
// WHEN it runs: Chrome binds a permanent extension ID to the first upload, and
// "which build was that" cannot be answered later. This asserts the step exists
// and reads the stamp from the ARTIFACT, and deliberately not which profile is
// correct: that is an operator decision, and pinning it would make this
// rubber-stamp whatever it is pointed at.
const profileSteps = phase4.split('\n').filter((l) => /build-profile\.txt/.test(l));
assert.ok(profileSteps.length >= 1,
    'FAIL: Phase 4 never tells the operator to record which build profile is being uploaded. The wallet '
    + 'builds at two profiles that differ in which surfaces exist, the mobile lane uses `store` and this '
    + 'lane uses `default`, and the store binds a permanent extension ID to the first upload. The step '
    + 'must read the stamp out of the artifact (unzip -p ... build-profile.txt).');

// The stamp has to be read from the ZIP: `packages/extension/dist` is gitignored
// and is whatever the shared worktree last built, so a step pointed there
// certifies a profile the uploaded bytes never had (§12's defect).
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

// 20. The ceremony page may say what it does not COVER; it may not report what
//     has not been DECIDED.
//
// Measured 2026-08-07, the page's "deliberately does not cover" list still read
// "Store API upload automation. Not decided." while tools/release/cws-upload.mjs
// was built, gated and on origin/master. The generalizing form is what is
// gated, because the instance will not recur in the same words: "this page does
// not cover X" stays true whatever is decided, while "X is not decided" is a
// copy of a fact held in the spec's register and rots the day it is taken.
const decisionState = [...ceremony.matchAll(/[^\n]*\b(not decided|undecided|not yet decided|once decided|pending a decision)\b[^\n]*/gi)]
    .map((m) => m[0].trim());
assert.equal(decisionState.length, 0,
    'FAIL: the ceremony page reports the STATE of a decision rather than what it covers:\n  '
    + decisionState.map((l) => l.slice(0, 160)).join('\n  ')
    + '\nA decision is recorded in the spec\'s own register, which this page cannot see. The page '
    + 'goes stale the moment the decision is taken, and it goes stale silently, because whoever '
    + 'takes the decision is not reading this page. Say what the runbook does not cover, or say '
    + 'what was decided and point at the thing it produced. Do not report that nobody has chosen.');

// 19. A fix to the signing tooling does not reach a release already tagged, so
//     the field it makes honest can still be a lie.
//
// "Signing runs the tag's copy of sign.sh" is FALSE: the tree sign.sh verifies
// the tag against is `--repo`, and only the files it READS out of that tree
// belong to the tag, while sign.sh and lib.sh come from whichever checkout was
// invoked. So the class splits, and each half is asked about the file that
// really carries it:
//
//   * The dev-mock GATE SCRIPT does come from the tag, so the empty-scan defect
//     is reachable today: the gate finds no dist/ in the pristine clone, prints
//     OK on an empty scan, and `# dev-mock-gate: enforced` goes into the signed
//     manifest Phase 4a reads as provenance. sign.sh now requires the gate's
//     receipt ("N bundle(s) scanned") first, and the ceremony step diagnoses
//     that refusal, so it must name the GATE script rather than sign.sh.
//   * The `--lane` FLAG does not. Grepping the tag's sign.sh for it answers 0
//     for every tag ever cut and would have blocked the one partial manifest
//     this project published; what the tag must carry is the lane TABLE.
//
// The floor stays at two steps because the failure being prevented is a phase
// that reads the header and asks nothing about who wrote it.
const tagGateSteps = phase4.split('\n')
    .filter((l) => /^⬜/.test(l) && /--artifacts|dev-mock-gate/.test(l));
assert.ok(tagGateSteps.length >= 2,
    'FAIL: Phase 4a checks the `# dev-mock-gate:` header field but never asks which gate wrote it. '
    + 'The gate script comes from the tag even though sign.sh does not, and every tag cut to date '
    + 'carries the version that scans the repo\'s dist/ trees, which a pristine clone does not have, '
    + 'so it writes `enforced` on a scan that read nothing. sign.sh refuses that now; the step is '
    + 'how an operator reads the refusal.');

// §8's two halves again: the step must name a marker really present in the file
// it greps, or it rots into a grep matching nothing that passes every tag. The
// FILE is the assertion: aiming this probe at sign.sh is the defect above, since
// sign.sh is the one file in the signing path a tag does not supply.
const tagGateProbe = phase4.match(/git show[^\n]*check-no-dev-mock\.sh[^\n]*\n?[^\n]*/);
assert.ok(tagGateProbe && /--artifacts/.test(tagGateProbe[0]),
    'FAIL: Phase 4a has no command that reads the DEV-MOCK GATE out of the tag. If it greps '
    + '`vX.Y.Z:tools/release/sign.sh`, that is the pre-S38 step and it asks the tag about the one '
    + 'file that does not come from the tag: sign.sh is supplied by the checkout the operator '
    + 'invokes, which is why `--repo` exists at all.');

const signSh = readFileSync(join(walletRoot, 'tools', 'release', 'sign.sh'), 'utf8');
const devMockInvocation = signSh.slice(signSh.indexOf('DEV_MOCK_CHECK='));
assert.ok(/--artifacts/.test(devMockInvocation),
    'FAIL: the marker the ceremony greps a tag for (`--artifacts`) is no longer how sign.sh points '
    + 'the dev-mock gate at the release. Either the invocation was reworded, in which case the '
    + 'ceremony step now passes every tag including the blind ones, or the gate went back to '
    + 'scanning the repo. Both are worse than the defect this step was written for, because this '
    + 'time a check says OK.');
assert.ok(/bundle\\\(s\\\) scanned/.test(devMockInvocation),
    'FAIL: sign.sh no longer requires the dev-mock gate to say how many staged bundles it read, so '
    + '`# dev-mock-gate: enforced` is back to meaning "the gate exited 0", which an older tag\'s '
    + 'gate does after scanning nothing. That word is read as provenance by Phase 4a and the '
    + 'desktop updater refuses any release without it.');

// The lane half. Named on the same evidence: this grep must not be aimed at
// sign.sh, and the file it IS aimed at has to declare the lane the ceremony
// signs with.
const laneProbe = phase4.match(/git show[^\n]*shipped-lanes\.txt[^\n]*/);
assert.ok(laneProbe,
    'FAIL: Phase 4a-bis does not ask whether the tag DECLARES the extension lane. If it greps the '
    + 'tag\'s sign.sh for `--lane` instead, that answers 0 for every tag ever cut - including '
    + 'v0.336.0, from which a partial manifest was in fact signed and published - and sends the '
    + 'operator to cut a new tag for a reason that is not the real one.');
// Scoped to the fenced blocks, which is what an operator runs: the prose may
// quote the retired command in order to warn against it, and reddening on that
// warning is §5's S14 lesson.
const phase4Commands = [...phase4.matchAll(/```[a-z]*\n([\s\S]*?)```/g)]
    .map((m) => m[1]).join('\n');
assert.doesNotMatch(phase4Commands, /git show[^\n]*sign\.sh[^\n]*--lane/,
    'FAIL: Phase 4a-bis still hands the operator a grep of the TAG\'s sign.sh for `--lane`. '
    + 'sign.sh comes from the checkout the operator invokes, not from the tag; `--repo` is what '
    + 'makes that so, and the Android lane signed v0.336.0 that way. This step blocks a submission '
    + 'that is not blocked.');

const laneTable = readFileSync(join(walletRoot, 'tools', 'release', 'shipped-lanes.txt'), 'utf8');
assert.match(laneTable, /^extension\s+(SHIPPED|NOT-SHIPPED)\s/m,
    'FAIL: tools/release/shipped-lanes.txt no longer declares the `extension` lane, so the command '
    + 'Phase 4a-bis hands the operator greps for a row that cannot exist and `--lane extension` '
    + 'refuses every release. That row is what takes the Chrome submission off the desktop lanes\' '
    + 'signing blockers.');

// 18. The command the ceremony hands you must reach the ceremony's own staging
//     path.
//
// §12's class one step earlier: a linked command that cannot reach the artifact
// AT ALL, whose failure reads as "the release was never staged" rather than
// "the shorthand is wrong". Phase 4a checks `release-artifacts/vX.Y.Z/` while
// `pnpm release:sign` resolved to `release-artifacts/<version>`, so the
// documented shorthand pointed at a directory no release has ever used, and the
// natural next move is to re-stage or to pass the path by hand and get it
// subtly wrong. The assertion is about AGREEMENT rather than a literal: the
// page and the package script must not drift into two answers about where a
// release lives.
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

// 21. The assets are checked for their SIZE; the page has to ask what they SHOW.
//
// §8's two halves aimed at an image. A pixel-dimension check settles the
// address: measured 2026-08-06 the four assets were captured at v0.333.1 while
// the staged release was v0.336.0, 33 commits later, one of them a fix to the
// consent lines inside the sign-approval window, which IS one of the
// screenshots, and every check was green through it. The drift half cannot live
// in a smoke, which would go red on every UI commit until somebody recaptured,
// so it goes in the step that uploads the images; this section holds that the
// step is there and really RUNS the tool (§§12, 18).
const phase5 = ceremony.slice(ceremony.indexOf('### Phase 5'),
    ceremony.indexOf('### Phase 6'));
assert.ok(phase5.length > 0,
    'FAIL: Phase 5 (the listing form) is not on the ceremony page, and it is the phase that uploads '
    + 'the four listing assets.');

const assetTool = 'tools/release/verify-listing-assets.mjs';
assert.ok(existsSync(join(walletRoot, assetTool)),
    `FAIL: ${assetTool} does not exist, so the Phase 5 step below hands the operator a command that `
    + 'cannot run. §12s defect: a cited command is a citation like any other.');
assert.ok(phase5.includes(assetTool),
    `FAIL: Phase 5 never runs ${assetTool}. The assets' pixel dimensions are checked in two places `
    + 'and what they DEPICT in none, so a screenshot of a build nobody can install uploads clean - '
    + 'onto a listing whose extension ID is permanent from the first upload.');

// --since, named against the TAG. Defaulted to a working tree the tool answers
// a question nobody asked, since the subject is the build being uploaded: §12's
// finding applied before it can happen again.
const assetStep = phase5.split('\n').find((l) => l.includes(assetTool)) || '';
assert.ok(/--since\s+v/.test(assetStep),
    `FAIL: Phase 5 runs ${assetTool} without \`--since vX.Y.Z\`. Defaulted to HEAD it measures this `
    + "machine's working tree, which is not what is being uploaded, and it would report CLEAN on a "
    + 'checkout that happens to sit at the capture commit.');

// All three outcomes have to be written down, and INCONCLUSIVE is the one that
// gets dropped: a tool that cannot tell prints a verdict either way, and a
// page that names only CLEAN and STALE lets "it printed something" pass.
for (const [word, why] of [
    ['CLEAN', 'the passing outcome'],
    ['STALE', 'the outcome that must stop the upload'],
    ['INCONCLUSIVE', 'the outcome that looks like neither and is not a pass'],
]) {
    assert.ok(phase5.includes(word),
        `FAIL: Phase 5 does not say what ${word} means (${why}) when the listing-asset check runs. `
        + 'A three-state check read as two states resolves the missing state as a pass.');
}

// 22. The escape hatch out of another lane's blocker has to be real.
//
// For most of 2026-08 Phase 4 was blocked by two Windows installers that could
// not be Authenticode-signed, because sign.sh signs a release as a SET, and
// none of that touches the extension, whose signature requirement is `none`:
// Chrome signs the store item itself. sign.sh's --lane mode made a partial
// release signable. Three things must hold for the step to be more than prose:
// the lane exists in the committed list, its scope resolves to the extension
// zip and nothing else, and the page says a tag predating the mode cannot use
// it (§19's property, not a new one).
const laneFile = 'tools/release/shipped-lanes.txt';
const lanes = readFileSync(join(walletRoot, laneFile), 'utf8');
const laneRow = lanes.split('\n').find((l) => /^extension\s+/.test(l));
assert.ok(laneRow,
    `FAIL: ${laneFile} declares no 'extension' lane, so \`sign.sh --lane extension\` resolves to `
    + 'nothing and Phase 4a-bis hands the operator a command that refuses. A lane name is where a '
    + "lane's identity is declared; without the row there is no such thing as this lane.");
assert.ok(/xchain-wallet-extension-v\*\.zip/.test(laneRow),
    `FAIL: the 'extension' lane in ${laneFile} does not claim the extension zip glob, so its scope `
    + 'would demand some other artifact. The row must claim xchain-wallet-extension-v*.zip, which is '
    + 'the file the store actually receives.');
// SHIPPED or NOT-SHIPPED, deliberately not pinned to either: the value flips in
// the commit that records the first upload, and pinning it would make this
// rubber-stamp whatever it is pointed at (§17's rule).
assert.ok(/^extension\s+(SHIPPED|NOT-SHIPPED)\s/.test(laneRow),
    `FAIL: the 'extension' lane declares neither SHIPPED nor NOT-SHIPPED. lib.sh fails shut on an `
    + 'unrecognised status word rather than defaulting to the permissive branch, so this row would '
    + 'break every signing run rather than only this ceremony.');

const partial = ceremony.slice(ceremony.indexOf('#### 4a-bis'), ceremony.indexOf('#### 4b.'));
assert.ok(partial.length > 0,
    'FAIL: Phase 4 no longer carries the 4a-bis partial-release path. Without it the ceremony is '
    + "blocked whenever another lane's artifacts are not signable, which is the state it sat in for "
    + 'most of 2026-08 while the extension zip itself was fine.');
assert.ok(/--lane\s+extension/.test(partial),
    'FAIL: the 4a-bis step does not run `sign.sh --lane extension`. A partial release is scoped by '
    + 'LANE NAME; without it sign.sh demands the whole set again.');
assert.ok(/coverage:\s*partial/.test(partial) && /lanes:\s*extension/.test(partial),
    'FAIL: 4a-bis does not name the two header fields a partial manifest writes (`coverage: partial` '
    + 'and `lanes: extension`). Those fields are the whole reason a partial manifest is honest rather '
    + 'than a smaller claim made quietly, and an operator who does not know to look for them cannot '
    + 'tell a scoped manifest from a full one.');
// §19's class on a second flag: a step that says "use --lane" without saying
// "ask the tag whether it has --lane" sends the operator to a command this
// tag's sign.sh does not implement, and the failure reads as a broken tool.
assert.ok(/git show v[X.Y.Z]+:tools\/release\/sign\.sh/.test(partial) && /--lane/.test(partial),
    'FAIL: 4a-bis does not tell the operator to ask the TAG whether it carries --lane. Signing runs '
    + "from a pristine clone at the release tag, so it runs that tag's copy of sign.sh: a tag cut "
    + 'before the per-lane mode existed cannot use it, and the refusal would look like a tool fault. '
    + 'This is exactly the check 4a already makes for the dev-mock gate.');

// The other half: the lane is NOT-SHIPPED only until the first upload, so the
// ceremony must flip it in the same breath as the upload it records. A parity
// flip that waits to be remembered is one nobody makes.
const phase6 = ceremony.slice(ceremony.indexOf('### Phase 6'), ceremony.indexOf('### Phase 7'));
assert.ok(/shipped-lanes\.txt/.test(phase6) && /SHIPPED/.test(phase6),
    'FAIL: Phase 6 never flips the extension lane to SHIPPED. The lane is NOT-SHIPPED so that this '
    + 'submission could be signed while the desktop lanes were not signable; once real users have '
    + 'installed from the store, a release staging no extension zip is a lane left behind, and only '
    + 'the flip makes the shipped-lane gate say so.');

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

// 23. Every internal artifact the page REFERS TO has a map entry.
//
// §5 run backwards. §5 proves each pointer in §4a resolves; nothing proved each
// reference the ceremony MAKES has a pointer, and §5 stays green throughout
// because it only looks at what the map already contains. Measured 2026-08-07,
// "the project's own release tracking" appeared in the first two things an
// operator reads and no document in either repo said what it was.
//
// Derived from the page rather than listed, so a reference added tomorrow is
// caught: every definite noun phrase the harvest finds must be CLASSIFIED
// below, and a new one belongs to neither bucket and turns this red. That
// classification is a decision somebody has to make once, and this file's job
// is to make sure they are asked.
{
    const prose = ceremony
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

    // Bare "the store"/"the runbook" are excluded by requiring a qualifier:
    // an unqualified definite reference resolves from its own sentence. The
    // stop words drop phrases the pattern picks up mid-sentence ("the same
    // path the store", "the easy way to register"), which are not noun
    // phrases at all.
    const STOP = new Set(['same', 'one', 'all', 'easy', 'live', 'first', 'next',
        'other', 'only', 'whole', 'real', 'right', 'wrong', 'way', 'path', 'zip',
        'declaration', 'chrome', 'web', 'that', 'this', 'two', 'three', 'each',
        'any', 'new', 'old']);
    const HEADS = 'log|inventory|runbook|tracking|ledger|register|store';
    const re = new RegExp(`\\bthe ((?:[a-z][a-z0-9-]*(?:.s)? ){0,3}?)(${HEADS})\\b`, 'g');

    const found = new Set();
    for (const m of prose.matchAll(re)) {
        const quals = m[1].trim().split(/\s+/).filter(Boolean);
        if (!quals.length) continue;
        if (quals.some((w) => STOP.has(w.replace(/.s$/, '')))) continue;
        found.add(`the ${quals.join(' ')} ${m[2]}`);
    }

    // The classification. `map` names the §4a pointer the phrase resolves
    // through; `why` records what makes a phrase need no map at all.
    const CLASSIFIED = {
        'the correspondence log': { map: 'claude/reports/xchain-wallet/extension-store-correspondence.md' },
        "the operator's correspondence log": { map: 'claude/reports/xchain-wallet/extension-store-correspondence.md' },
        'the incident runbook': { map: 'claude/reports/launch/INCIDENT-RUNBOOK.md' },
        'the credential inventory': { map: 'claude/specs/wallet-release-rails.md' },
        'the release credential inventory': { map: 'claude/specs/wallet-release-rails.md' },
        'the recovery-credential store': { map: 'claude/specs/wallet-release-rails.md' },
        "the project's own release tracking": { map: 'claude/OPEN-ITEMS.md' },
        'the publish log': { why: 'the page gives its repo path in the same Phase 6 step' },
        'the explorer access log': { why: 'a server-side log described in the privacy prose, not an operator artifact' },
    };

    const unclassified = [...found].filter((p) => !CLASSIFIED[p]).sort();
    assert.equal(unclassified.length, 0,
        `the ceremony page refers to internal artifacts this file has never classified:\n  `
        + `${unclassified.join('\n  ')}\n`
        + 'Each is either something the operator can only find through the spec\'s §4a map (add the '
        + 'pointer there and the entry here) or something the page resolves itself (record why '
        + 'here). Leaving it unclassified is how "the project\'s own release tracking" sat on the '
        + 'ceremony\'s first two steps with no document anywhere naming it.');

    const dead = Object.keys(CLASSIFIED).filter((p) => !found.has(p)).sort();
    assert.equal(dead.length, 0,
        `this file classifies phrases the ceremony page no longer uses:\n  ${dead.join('\n  ')}\n`
        + 'A classification nobody can reach is a second copy going stale on its own, which is the '
        + 'defect this whole gate exists to prevent. Drop the entry in the same change that '
        + 'reworded the page.');

    // The mapped ones have to be mapped WHERE the operator is told to look.
    // §5 then proves those paths resolve, so the two halves meet: this one
    // says the map covers the page, §5 says the map is not dangling.
    if (existsSync(specPath)) {
        const spec4a = readFileSync(specPath, 'utf8');
        const s = spec4a.indexOf('## 4a. The private pointers');
        const e = spec4a.indexOf('\n## ', s + 1);
        const map4a = s === -1 ? '' : spec4a.slice(s, e === -1 ? undefined : e);
        const unmapped = Object.entries(CLASSIFIED)
            .filter(([, v]) => v.map && !map4a.includes(v.map))
            .map(([p, v]) => `${p} -> ${v.map}`);
        assert.equal(unmapped.length, 0,
            `the ceremony refers to these, and the spec's §4a map does not carry them:\n  `
            + `${unmapped.join('\n  ')}\n`
            + 'The published page is forbidden to name them, so §4a is the only place an operator '
            + 'can find them. A reference with no entry is a step that cannot be executed by '
            + 'anyone who does not already know the answer.');
    }
}

// 24. The spec's own prescriptive half may not record a value the code
//     contradicts.
//
// §10 turned on the file that owns §10. The slashless URL §10 was written to
// prevent was already sitting in this spec's §8 decision register, the place a
// reader looks up what was decided, and stayed there through seventeen stages
// while every check aimed at the value looked at the ceremony page or the tool.
// Measured 2026-08-09 by driving it: that form answers 301 to the one everything
// else carries, a redirect hop on the single field the store form validates. 1
// of 34 occurrences across five repos was wrong, and it was the register's.
//
// Scoped to the PRESCRIPTIVE half, between TWO edges: everything above `## 1.`
// is the record of what happened and must be able to quote the wrong form in
// order to describe it, and §9's stage table below is the same thing. The first
// cut had only the upper edge and fired on its own stage row (§5's S14). The
// canonical form is DEFAULT_URL, imported rather than restated, and the note is
// assigned in BOTH branches because a summary claiming coverage on a run that
// never opened the file is §13's degrade-quietly defect.
let urlNote;
if (existsSync(specPath)) {
    const spec = readFileSync(specPath, 'utf8');

    const bodyStart = spec.indexOf('\n## 1. ');
    const bodyEnd = spec.indexOf('\n## 9. ');
    assert.ok(bodyStart > 0 && bodyEnd > bodyStart,
        `${specPath} no longer opens its prescriptive half at "## 1." and close it at "## 9.", so this `
        + 'check cannot tell the spec\'s historical halves from its prescriptive one and has silently '
        + 'stopped checking anything. That is the failure mode §13 was rewritten to prevent: a check '
        + 'that degrades quietly still prints a verdict. Re-derive both edges against the new structure '
        + 'rather than widening this to the whole file, which is how it starts firing on the stage '
        + 'table\'s own account of the defect.');

    const base = DEFAULT_URL.replace(/\/+$/, '');
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = spec.slice(bodyStart, bodyEnd);

    const wrong = [];
    for (const m of body.matchAll(new RegExp(`${escaped}[^\\s\`)\\]<>,;]*`, 'g'))) {
        if (m[0] === DEFAULT_URL) continue;
        const line = spec.slice(0, bodyStart + m.index).split('\n').length;
        wrong.push(`${specPath}:${line} records "${m[0]}", not "${DEFAULT_URL}"`);
    }

    assert.equal(wrong.length, 0,
        `the spec's prescriptive half records a non-canonical form of the one field the Chrome Web `
        + `Store submission form validates:\n  ${wrong.join('\n  ')}\n`
        + `Measured 2026-08-09: the slashless form answers 301 to ${DEFAULT_URL}. The ceremony warns `
        + 'two paragraphs before that step that a redirect hop is a rejection cause, and §10 of this '
        + 'file already says in prose that retyping from memory is how the slashless form gets '
        + 'pasted. Record the canonical form here, or if the hosted URL really moved, move '
        + 'DEFAULT_URL in verify-privacy-url.mjs and let this section follow it.');

    urlNote = `the spec's prescriptive half records ${DEFAULT_URL} rather than a form that redirects`;
} else {
    urlNote = 'the spec\'s URL canonicalisation was NOT checked on this run';
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
    + `and ${driftNote}; the release shorthand reaches the ceremony's own staging path, Phase 5 `
    + `asks what the listing assets DEPICT, not only what size they are, and ${urlNote})`);
