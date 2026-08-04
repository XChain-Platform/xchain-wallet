// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A store ceremony is transcribed by hand, so it has to CARRY the values.
//
// THE DEFECT THIS WAS WRITTEN FOR . 's port rendered the store
// documents as evergreen public prose, and prose deduplicates: the per-store
// pages stopped naming the trader entity, address, email and phone and said
// "use the same contact details published on the other listings" with a link to
// the record instead. That is correct for documentation and wrong for a
// checklist. An operator sitting at a console form cannot follow a link out of
// a document into another document to find the four values the EU DSA is about
// to publish permanently; they type what is in front of them, and what is not
// in front of them they guess or leave blank.
//
//  fixed it for Chrome. The sibling sweep then measured the same thing
// on mobile with the store-trader-identity smoke's OWN definition of a
// transcribable surface: the four pre-migration mobile documents carried four
// such surfaces between them and the ported tree carried one. That is the third
// time in a week that a rule was right and the mechanism holding it was scoped
// to the one page somebody happened to be looking at, so this gate ENUMERATES
// the release pages and refuses a page with no declaration, the way
// store-ceremony-operational.smoke.js does. A new store lane joins by existing.
//
// WHAT IT IS NOT. Not a second copy of the values: every expected value is READ
// from privacy/trader-identity.md, the declaration of record, so this file goes
// stale by construction if the record changes and the pages do not. That is the
// difference between gating a translation and duplicating the original.
//
// Its sibling gates hold the other halves and are deliberately not merged with
// this one: store-trader-identity.smoke.js proves nothing CONTRADICTS the
// record (a wrong value), store-ceremony-operational.smoke.js proves the pages
// stay executable (steps and commands). This one proves the values are PRESENT
// where they get typed, which absence passes both of the others.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, readDoc, skipUnlessDocs } from '../_docs-repo.js';

skipUnlessDocs('store identity-transcription smoke');

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = join(here, '..', '..', '..');

// --- The record, read and never restated -------------------------------

const RECORD = 'privacy/trader-identity.md';
const recordRaw = readDoc(...RECORD.split('/'));
const record = {};
for (const m of recordRaw.matchAll(/^\|\s*([A-Za-z ]+?)\s*\|\s*`?([^|`]+?)`?\s*\|\s*$/gm)) {
    const field = m[1].trim().toLowerCase();
    if (field === 'field') continue;
    record[field] = m[2].trim();
}

// The four the declaration publishes on the listing itself, which is why they
// are public and why a ceremony may carry them. The rest of the record (city,
// state, postal code) is checked as part of the address rather than alone: a
// half-updated address is the quiet failure, since every line looks plausible
// by itself.
const PUBLISHED = ['entity', 'street', 'email', 'phone'];
const ADDRESS_REST = ['city', 'state', 'postal code'];

for (const field of [...PUBLISHED, ...ADDRESS_REST]) {
    assert.ok(record[field],
        `${RECORD} defines no "${field}" row, so this gate cannot say what the ceremonies are supposed `
        + 'to carry and every check below narrows silently. Fix the record first: it is the source, and '
        + 'nothing here restates it.');
}

// --- Which pages are transcribed, declared rather than assumed ----------

const TRANSCRIBES = {
    'release/extension/chrome-web-store.md': {
        transcribes: true,
        note: 'restored by  after the docs port scrubbed the values; the worked example',
    },
    'release/mobile/android-play.md': {
        transcribes: true,
        note: 'restored 2026-08-03  from the pre-migration PLAY_LISTING block, sanitized: '
            + 'the operator-security reasoning behind the number stays in the private spec',
    },
    'release/mobile/ios-app-store.md': {
        transcribes: true,
        note: 'restored 2026-08-03 ; the ported page had the trader row and none of the values',
    },
    // ---- DECLARED NON-TRANSCRIBERS ------------------------------------
    //
    // A false here asserts nothing about quality; it says the page is
    // ENUMERATED and cannot be mistaken for covered. The rule below runs in
    // both directions, so a page that starts carrying identity values joins
    // this gate by tripping it, not by somebody remembering.
    'release/desktop/mac-app-store.md': {
        transcribes: false,
        note: 'KNOWN GAP: the Mac App Store publishes an EU DSA trader declaration too, and this '
            + 'ceremony does not mention one. Registered rather than invented from here: it is the '
            + 'desktop lane\'s decision whether that declaration is made on the same developer account '
            + 'as iOS, and guessing at it would put values on a permanent public listing',
    },
    'release/desktop/microsoft-store.md': {
        transcribes: false,
        note: 'KNOWN GAP: same shape as the Mac App Store row above, on a different account',
    },
    'release/desktop/snap-store.md': { transcribes: false, note: 'no trader declaration on this store' },
    'release/desktop/windows.md': { transcribes: false, note: 'distribution lane, no store form' },
    'release/desktop/macos.md': { transcribes: false, note: 'distribution lane, no store form' },
    'release/desktop/linux.md': { transcribes: false, note: 'distribution lane, no store form' },
    'release/extension/test-dapp-runbook.md': { transcribes: false, note: 'a developer runbook' },
    'release/ci-setup.md': { transcribes: false, note: 'reference, not a console ceremony' },
    'release/verify-release.md': { transcribes: false, note: 'reader-facing verification' },
    'release/qa-checklist.md': { transcribes: false, note: 'pre-release QA, no console forms' },
};

// Enumerated, not listed: root pages and one level down, minus the lane index.
const storePages = [];
for (const entry of readdirSync(docsPath('release'), { withFileTypes: true })) {
    if (entry.isDirectory()) {
        for (const file of readdirSync(docsPath('release', entry.name))) {
            if (!file.endsWith('.md') || file.toLowerCase() === 'readme.md') continue;
            storePages.push(`release/${entry.name}/${file}`);
        }
    } else if (entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') {
        storePages.push(`release/${entry.name}`);
    }
}

assert.ok(storePages.length >= 3,
    `found only ${storePages.length} pages under release/, fewer than the three store ceremonies that `
    + 'exist. Either the enumeration broke or the pages moved, and both mean this gate watches nothing.');

// Checked before anything reads a page by name, so a rename says what is wrong
// instead of crashing a later read with a bare ENOENT.
for (const declared of Object.keys(TRANSCRIBES)) {
    assert.ok(storePages.includes(declared),
        `this gate declares ${declared}, and the enumeration never found it. A declaration that matches `
        + 'nothing protects nothing: the page was renamed, moved or deleted and its rule stopped '
        + 'applying without anything going red. Repoint the declaration, or drop it if the page is gone.');
}

// --- The transcribable surface, the same definition the sibling uses ----

/** Fenced and 4-space-indented blocks that present the entity: the paste surface. */
function transcribableBlocks(text) {
    const blocks = [];
    for (const m of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) blocks.push(m[1]);
    let run = [];
    for (const line of text.split('\n')) {
        if (/^ {4}\S/.test(line)) run.push(line);
        else { if (run.length) blocks.push(run.join('\n')); run = []; }
    }
    if (run.length) blocks.push(run.join('\n'));
    return blocks.filter((b) => b.includes(record.entity));
}

let surfaces = 0;

for (const page of storePages) {
    const entry = TRANSCRIBES[page];

    // The load-bearing half: an undeclared page is a FAILURE, not a skip.
    assert.ok(entry,
        `${page} is a release page with no entry in this gate, so nothing says whether an operator is `
        + 'meant to transcribe identity values off it. That is exactly how the mobile ceremonies lost '
        + 'theirs unnoticed for a day. Add an entry saying transcribes: true or false, with a reason.');

    const text = readDoc(...page.split('/'));
    const blocks = transcribableBlocks(text);

    if (!entry.transcribes) {
        assert.equal(blocks.length, 0,
            `${page} is declared as not transcribing identity values, and it carries ${blocks.length} `
            + `block(s) presenting "${record.entity}". A value that appears on a page nobody is holding `
            + `to the record is a value that drifts from it. Flip this page to transcribes: true (${entry.note}).`);
        continue;
    }

    // 1. The values are ON the page at all. Absence is the failure being
    // guarded, so presence is asserted rather than mere non-contradiction.
    for (const field of PUBLISHED) {
        assert.ok(text.includes(record[field]),
            `${page} never names the ${field} "${record[field]}" that ${RECORD} declares (${entry.note}). `
            + 'The EU DSA trader declaration is transcribed by hand into a console from this page, and a '
            + 'value that is not on it is one the operator guesses or leaves blank. It is then published '
            + 'permanently and publicly, and editing the field later does not unpublish what was indexed.');
    }

    // 2. And they are together in ONE block a human can copy. Four values
    // scattered through a page of prose is the state this gate exists to
    // reject: it reads as covered and transcribes as a scavenger hunt.
    const carrier = blocks.find((b) => PUBLISHED.every((f) => b.includes(record[f])));
    assert.ok(carrier,
        `${page} names the declared identity values but not together in one transcribable block `
        + `(${blocks.length} block(s) mention "${record.entity}"). A ceremony page is read under a clock, `
        + 'at a form, and a block that can be copied in one motion is the difference between a correct '
        + 'declaration and a partly-remembered one. Fenced or four-space-indented, either is fine.');
    surfaces += 1;

    // 3. The address is whole in that block. A street that moved without its
    // city or ZIP is worse than a stale one: every line looks right alone.
    for (const part of ADDRESS_REST) {
        assert.ok(carrier.includes(record[part]),
            `${page} presents the trader street address without "${record[part]}". A partially updated `
            + 'address passes every eyeball check and still publishes a wrong one.');
    }
}

assert.ok(surfaces >= 3,
    `only ${surfaces} pages were verified as carrying a transcribable identity block, and three store `
    + 'ceremonies declare one (Chrome, Play, App Store). If a lane genuinely stopped publishing a trader '
    + 'declaration, flip its entry to transcribes: false in the same change and say why.');

// --- The privacy URL is the ONE field that goes the other way -----------
//
// Worth stating, because the first cut of this gate got it backwards and
// privacy-url-check.smoke.js caught it. The transcription rule above does not
// generalize to the privacy-policy URL: that field has an existing, deliberate
// one-copy rule, and store documents LINK the policy rather than restating its
// address. The reason is the same incident from the other side. On 2026-08-02
// the Play listing named a URL that answered 200 and served a SUPERSEDED
// policy, which looked perfectly healthy from inside the console; a second copy
// of a URL is how that happens, while a second copy of the trader values is
// simply the values, which the store publishes verbatim anyway.
//
// So the distinction is not "duplication is bad", it is what each field IS. The
// trader block is a set of constants the console has no other route to. The URL
// is a pointer, and a pointer with two copies has a stale one. Nothing is
// asserted here: the rule is enforced in privacy-url-check.smoke.js, and
// duplicating it would be the same mistake in test form.

const urlRule = join(here, 'privacy-url-check.smoke.js');
assert.ok(existsSync(urlRule),
    'privacy-url-check.smoke.js is gone, and it is the gate holding the other half of a store form: '
    + 'that no store document restates the privacy-policy URL. This gate deliberately does not check '
    + 'that, on the reasoning above, so its disappearance leaves the field unheld. If it was renamed, '
    + 'repoint this line in the same change.');

// --- Nothing on these pages may name a phone the record does not --------
//
// A wide net on purpose, and wider than the value checks above: a phone number
// has no legitimate reason to appear on a release page except as THE published
// one, so catching a stale number in a sentence is a feature rather than a
// false positive.

const PHONE_SHAPE = /\+\d[\d\s().-]{7,}\d/g;
const norm = (s) => s.replace(/[\s().-]/g, '');
let phones = 0;

for (const page of storePages) {
    for (const phone of readDoc(...page.split('/')).match(PHONE_SHAPE) || []) {
        phones += 1;
        assert.equal(norm(phone), norm(record.phone),
            `${page} names the phone number "${phone.trim()}", which is not the trader phone `
            + `"${record.phone}" declared in ${RECORD}. One legal entity showing two public contacts is `
            + 'what a reviewer notices; if the published number changed, it changes in the record and on '
            + 'every store listing in the same pass.');
    }
}

// --- Every wallet-repo path these pages cite has to resolve -------------
//
// The Chrome gate does this for its two pages, and the mobile ceremonies now
// cite release scripts of their own, so it generalizes here for the same reason
// the transcription rule did. The docs repo tests its own internal links and
// cannot see this tree at all; this side is the only place that reads both.
//
// One-directional on purpose: a page may cite a file that knows nothing about
// it, so a path with no citation is fine and only a citation with no path fails.

const CITED = /`((?:packages|tools|test|\.github)\/[A-Za-z0-9_./-]+)`/g;
const dead = [];
let citations = 0;

// A cited path git IGNORES is a declared build output, not a dead command:
// `packages/extension/dist/` is produced by the build the ceremony runs first,
// so it is on the operator's machine and never in a clean checkout. Requiring
// it on disk made this gate pass in a worked-in tree and fail on a fresh one,
// which is the exact class of drift the gate exists to catch elsewhere.
const isDeclaredBuildOutput = (rel) => {
    try {
        execFileSync('git', ['-C', walletRoot, 'check-ignore', '-q', rel]);
        return true;
    } catch {
        return false;
    }
};

for (const page of storePages) {
    for (const m of readDoc(...page.split('/')).matchAll(CITED)) {
        if (/vX\.Y\.Z|<|\*/.test(m[1])) continue;              // version and shell placeholders
        citations += 1;
        if (existsSync(join(walletRoot, m[1]))) continue;
        if (isDeclaredBuildOutput(m[1])) continue;
        dead.push(`${page} cites ${m[1]}`);
    }
}

assert.equal(dead.length, 0,
    `release pages cite wallet-repo paths that do not exist:\n  ${dead.join('\n  ')}\n`
    + 'An operator following a published ceremony mid-submission meets a dead command, on a review '
    + 'clock, in a procedure whose steps do not all come back.');

assert.ok(citations > 0,
    'no wallet-repo paths were found cited on any release page, so the citation check passed without '
    + 'checking anything. These ceremonies tell an operator to run commands out of this repo; if they '
    + 'stopped doing that, rewrite this section rather than deleting it.');

console.log(`OK: store identity-transcription smoke (: ${storePages.length} release pages `
    + `enumerated, all declared; ${surfaces} carrying a transcribable block with all `
    + `${PUBLISHED.length} published values traced to ${RECORD}; ${phones} phone mention(s) checked; `
    + `${citations} cited wallet-repo paths resolved across the repo boundary)`);
