// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  D1 /  §6c: one trader identity, every store.
//
// Every major store forces a trader/non-trader declaration under the EU
// DSA, and declaring as a trader publishes the entity name, postal
// address, email AND phone on the public listing, permanently. Chrome,
// Play and the App Store each ask separately, and one legal entity showing
// two different public trader contacts is what a reviewer or a regulator
// notices.
//
// `docs/Trader_Identity.md` is the single set of values. This checks that
// the store documents agree with it.
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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const RECORD_PATH = 'docs/Trader_Identity.md';
assert.ok(existsSync(join(root, RECORD_PATH)), `${RECORD_PATH} exists`);

// --- 1. The record itself ----------------------------------------------

const recordRaw = read(RECORD_PATH);

// Field table: | Field | `value` |
const record = {};
for (const m of recordRaw.matchAll(/^\|\s*([A-Za-z ]+?)\s*\|\s*`([^`]+)`\s*\|\s*$/gm)) {
    record[m[1].trim().toLowerCase()] = m[2].trim();
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

const DOC_ROOTS = ['docs', 'packages/extension/docs', 'packages/mobile/docs', 'packages/desktop/docs'];

function* walkMd(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) continue;
        if (name.endsWith('.md')) yield full;
    }
}

const traderDocs = [];
for (const r of DOC_ROOTS) {
    for (const full of walkMd(join(root, r))) {
        const rel = relative(root, full);
        if (rel === RECORD_PATH) continue;
        if (/trader/i.test(readFileSync(full, 'utf8'))) traderDocs.push(rel);
    }
}

assert.ok(traderDocs.length >= 3,
    `expected at least 3 store documents to make trader claims, found ${traderDocs.length}. Either the `
    + 'document set moved out from under DOC_ROOTS or the scan stopped matching, and every check below is '
    + 'then vacuous.');

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

assert.ok(surfacesChecked >= 3,
    `only ${surfacesChecked} transcribable trader surfaces were found across ${traderDocs.length} `
    + 'documents; expected at least 3. The block/row extraction stopped matching, so the checks above '
    + 'passed on nothing.');

// A wider net for the phone specifically. It has no legitimate reason to
// appear anywhere in these documents except as THE published number, so
// unlike the email it does not need surface-scoping, and catching it in
// prose is a feature: a stale number quoted in a sentence is still a stale
// number someone will act on.
for (const doc of traderDocs) {
    for (const phone of read(doc).match(PHONE_SHAPE) || []) {
        assert.equal(norm(phone), norm(record.phone),
            `${doc} names the phone number "${phone.trim()}", which is not the declared trader phone `
            + `"${record.phone}" in ${RECORD_PATH}. If the published number changed, it changes in the `
            + 'record and in every store listing in the same pass.');
    }
}

// --- 4. The record has to be findable ----------------------------------

assert.ok(read('docs/README.md').includes('Trader_Identity.md'),
    'docs/README.md does not index Trader_Identity.md. Nobody filling in a store form finds a declaration '
    + 'of record that the docs index does not mention, which is how the duplicate copies started.');

console.log(`OK: store trader-identity smoke ( D1: ${traderDocs.length} store documents, `
    + `${surfacesChecked} transcribable surfaces, all agreeing with ${RECORD_PATH})`);
