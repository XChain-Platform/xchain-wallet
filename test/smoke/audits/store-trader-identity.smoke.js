// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for D1 §6c: one trader identity, every store.
//
// Every major store forces a trader/non-trader declaration under the EU
// DSA, and declaring as a trader publishes the entity name, postal
// address, email AND phone on the public listing, permanently. Chrome,
// Play and the App Store each ask separately, and one legal entity showing
// two different public trader contacts is what a reviewer or a regulator
// notices.
//
// The trader-identity doc is the single set of values. This checks that the
// store documents agree with it. a later change moved all of them into the sibling
// xchain-documentation checkout, under components/wallet/, so the scan
// crosses the repo boundary and skips loudly when that checkout is absent.
//
// Not hypothetical. On 2026-08-01 two Play documents still named
// `support@xchain.io` for this declaration, months after `info@dankest.llc`
// had replaced it, and both sat directly underneath a paragraph warning
// against exactly that inconsistency. Prose warning people to stay
// consistent does not keep them consistent.
//
// WHAT THIS CHECKS, AND WHY IT IS NOT "EVERY EMAIL IN THE FILE".
// These documents legitimately NAME the retired address in order to say it
// is retired ("info@dankest.llc supersedes the support@xchain.io this step
// used to name"). A check that fires on correct prose is one people delete,
// so this targets TRANSCRIBABLE SURFACES only: the fenced or indented
// blocks a human copies into a console, and the table rows that present a
// trader field as a value. Prose may discuss whatever it needs to; the
// thing that gets pasted into a store form has to be right.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, readDoc, skipUnlessDocs, WALLET_DOCS } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(WALLET_DOCS, p), 'utf8');

skipUnlessDocs('store trader-identity smoke');

const RECORD_PATH = 'privacy/trader-identity.md';
assert.ok(existsSync(docsPath('privacy', 'trader-identity.md')), `${RECORD_PATH} exists`);

// --- 1. The record itself ----------------------------------------------

const recordRaw = read(RECORD_PATH);

// Field table: | Field | value |, with or without backticks around the
// value. The port dropped the backticks; the values are the point.
const record = {};
for (const m of recordRaw.matchAll(/^\|\s*([A-Za-z ]+?)\s*\|\s*`?([^|`]+?)`?\s*\|\s*$/gm)) {
    const field = m[1].trim().toLowerCase();
    if (field === 'field') continue;
    record[field] = m[2].trim();
}

const REQUIRED = ['entity', 'street', 'city', 'state', 'postal code', 'email', 'phone', 'country'];
for (const field of REQUIRED) {
    assert.ok(record[field],
        `${RECORD_PATH} has no "${field}" row in its field table, or the table shape changed. Every other `
        + 'check in this file reads that table, so a missing field silently narrows what is enforced.');
    assert.ok(!/TBD|PENDING|UNSETTLED|xxx/i.test(record[field]),
        `${RECORD_PATH} still carries a placeholder for "${field}" (${record[field]}). This file is the `
        + 'declaration of record; a placeholder here becomes a placeholder on a public listing.');
}

assert.match(record.email, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, 'the record email is an email address');
assert.match(record.phone, /^\+\d[\d\s().-]{6,}$/, 'the record phone is in international format');
assert.match(record['postal code'], /^\d{5}(-\d{4})?$/, 'the record postal code is a full US ZIP');

// --- 2. Which documents make trader claims -----------------------------

// The whole wallet documentation tree, walked recursively: the per-store
// runbooks that carry trader claims now sit two directories deep
// (release/extension/, release/mobile/), so a flat scan would miss them.
function* walkMd(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { yield* walkMd(full); continue; }
        if (name.endsWith('.md')) yield full;
    }
}

const traderDocs = [];
for (const full of walkMd(WALLET_DOCS)) {
    const rel = relative(WALLET_DOCS, full);
    if (rel === RECORD_PATH) continue;
    if (/trader/i.test(readFileSync(full, 'utf8'))) traderDocs.push(rel);
}

assert.ok(traderDocs.length >= 3,
    `expected at least 3 store documents to make trader claims, found ${traderDocs.length}. Either the `
    + 'document set moved out from under the wallet docs tree or the scan stopped matching, and every '
    + 'check below is then vacuous.');

// --- 3. Transcribable surfaces must match the record -------------------

const PHONE_SHAPE = /\+\d[\d\s().-]{7,}\d/g;
const EMAIL_SHAPE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const norm = (s) => s.replace(/[\s().-]/g, '');

/** Fenced and indented blocks that present the entity: the copy-paste surface. */
function transcribableBlocks(text) {
    const blocks = [];
    for (const m of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) blocks.push(m[1]);
    // Indented blocks: runs of 4-space-indented lines.
    let run = [];
    for (const line of text.split('\n')) {
        if (/^ {4}\S/.test(line)) run.push(line);
        else { if (run.length) blocks.push(run.join('\n')); run = []; }
    }
    if (run.length) blocks.push(run.join('\n'));
    return blocks.filter((b) => b.includes(record.entity));
}

/** Table rows whose first cell presents a trader field as a value. */
function traderTableRows(text) {
    return text.split('\n').filter((l) => /^\|/.test(l) && /trader/i.test(l.split('|')[1] || ''));
}

let surfacesChecked = 0;

for (const doc of traderDocs) {
    const text = read(doc);
    const surfaces = [...transcribableBlocks(text), ...traderTableRows(text)];

    for (const surface of surfaces) {
        surfacesChecked += 1;

        for (const phone of surface.match(PHONE_SHAPE) || []) {
            assert.equal(norm(phone), norm(record.phone),
                `${doc} presents the trader phone as "${phone.trim()}" but ${RECORD_PATH} declares `
                + `"${record.phone}". This is a surface a human transcribes into a store form, so a `
                + 'mismatch here becomes two different public trader contacts for one legal entity.');
        }

        for (const email of surface.match(EMAIL_SHAPE) || []) {
            assert.equal(email, record.email,
                `${doc} presents "${email}" as a trader contact but ${RECORD_PATH} declares `
                + `"${record.email}". Prose may discuss a retired address; a block or row someone pastes `
                + 'into a console may not carry one.');
        }

        // A half-updated address is the quiet failure: the street moves and
        // the city or ZIP does not, and both halves look plausible alone.
        if (surface.includes(record.street)) {
            for (const part of [record.city, record.state, record['postal code']]) {
                assert.ok(surface.includes(part),
                    `${doc} presents the trader street address but not "${part}". A partially updated `
                    + 'address is worse than a stale one: every line looks plausible on its own.');
            }
        }
        if (surface.includes(record['postal code'])) {
            assert.ok(surface.includes(record.street),
                `${doc} presents the trader postal code without the street from ${RECORD_PATH}`);
        }
    }
}

// No floor on surfacesChecked any more, and that is the point rather than a
// weakening. that port stopped duplicating the trader VALUES into the
// per-store runbooks: they now say "use the same contact details across
// every listing" and link the record. There is nothing left to drift, which
// is the state this check was trying to enforce. The loop above still runs,
// so a re-introduced copy is compared the moment it appears.
//
// The document-wide scans below are what carry the check now, and they have
// a real subject: no store document may name a phone number or a trader
// email that is not the declared one, in a block, a row, or plain prose.
assert.ok(traderDocs.length >= 3,
    `only ${traderDocs.length} documents making trader claims were scanned; expected at least 3`);

// A wide net for the phone specifically. It has no legitimate reason to
// appear anywhere in these documents except as THE published number, so
// unlike the email it does not need surface-scoping, and catching it in
// prose is a feature: a stale number quoted in a sentence is still a stale
// number someone will act on.
let scanned = 0;
for (const doc of traderDocs) {
    for (const phone of read(doc).match(PHONE_SHAPE) || []) {
        scanned += 1;
        assert.equal(norm(phone), norm(record.phone),
            `${doc} names the phone number "${phone.trim()}", which is not the declared trader phone `
            + `"${record.phone}" in ${RECORD_PATH}. If the published number changed, it changes in the `
            + 'record and in every store listing in the same pass.');
    }
}

// The retired trader email must not come back anywhere in these documents,
// not even in prose. This is the 2026-08-01 regression exactly: two Play
// documents still named support@xchain.io months after info@dankest.llc
// replaced it, sitting under a paragraph warning against that very thing.
const RETIRED_TRADER_EMAILS = ['support@xchain.io'];
for (const doc of traderDocs) {
    const text = read(doc);
    for (const retired of RETIRED_TRADER_EMAILS) {
        assert.ok(!text.includes(retired),
            `${doc} still names ${retired}. The declared trader email is "${record.email}" `
            + `(${RECORD_PATH}); one legal entity showing two public contacts is what a reviewer notices.`);
    }
    scanned += 1;
}

// --- 4. The record has to be findable ----------------------------------

const walletIndex = readDoc('README.md');
assert.ok(/trader identity/i.test(walletIndex),
    'the wallet docs index does not mention the trader-identity declaration. Nobody filling in a store '
    + 'form finds a declaration of record the index does not name, which is how the duplicate copies '
    + 'started.');

console.log(`OK: store trader-identity smoke (D1: ${traderDocs.length} store documents,`
    + `${surfacesChecked} transcribable surfaces, ${scanned} document-wide scans, all agreeing with `
    + `${RECORD_PATH})`);
