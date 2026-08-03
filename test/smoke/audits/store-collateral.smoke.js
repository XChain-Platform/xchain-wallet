// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §6c: the shared store-submission collateral.
//
// Every store hard-blocks submission without a privacy policy URL, and
// Play and Apple each want a data declaration on top. The content is
// shared (one wallet, one data posture), so it is written once in the
// data-collection doc and transcribed. This smoke exists because the
// failure mode for that collateral is silent: prose rots against code with
// nothing to notice, and the thing you find out later is that you declared
// something untrue to a store.
//
//  moved the three documents into the sibling xchain-documentation
// checkout, under components/wallet/privacy/, and PUBLISHED them. The
// draft-hygiene checks that used to lead this file (a DRAFT banner while
// [UNSETTLED] markers remain, no pending marker in the publishable body,
// the record and the policy agreeing on which Q<n> are still open) went
// with that: every one of those markers is gone, because the documents are
// no longer drafts. They are not reworded here, they are deleted, since a
// check with no subject that still passes is worse than no check.
//
// Two checks earn their keep here.
//
// 1. Every host the policy discloses is named in the declaration of record,
//    derived from the policy rather than from a list someone maintains.
//
// 2. The Tor claim . `settings.privacy.torRouting` is offered
//    in the UI as "route SDK requests through a local Tor SOCKS5 proxy"
//    and NOTHING consumes it - there is no SOCKS plumbing in the wallet
//    or the SDK. So the collateral must warn against claiming Tor
//    support. This smoke derives whether that is still true from the
//    code rather than hard-coding it: the day someone implements the
//    toggle, this test fails and tells them the docs now need updating.
//    That is deliberate. A stale "we don't support Tor" warning is a
//    smaller problem than a stale "we do", but both are wrong, and the
//    check should notice either.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, readDoc, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

skipUnlessDocs('store-collateral smoke');

const DOCS = {
    record: docsPath('privacy', 'data-collection.md'),
    policy: docsPath('privacy', 'privacy-policy.md'),
    export: docsPath('privacy', 'export-compliance.md'),
};

for (const p of Object.values(DOCS)) {
    assert.ok(existsSync(p), `${p} exists`);
}

// The wallet docs index has to reach them, or nobody filling in a store
// form finds the document they were supposed to transcribe.
const docsIndex = readDoc('README.md');
assert.ok(docsIndex.includes('privacy/privacy-policy.md'),
    'the wallet docs index links the privacy section');
assert.match(docsIndex, /data collection/i,
    'the wallet docs index says the privacy section carries the store collateral');

// Collapse whitespace before matching prose. These files are hard
// wrapped, so any phrase long enough to be worth asserting on will
// eventually straddle a line break, and a check that breaks when
// someone rewraps a paragraph trains people to delete the check.
const flat = (p) => readFileSync(p, 'utf8').replace(/\s+/g, ' ');

const record = flat(DOCS.record);
const policy = flat(DOCS.policy);
const exportDoc = flat(DOCS.export);

// --- 2. The declaration must cover what the code actually does ---------
//
// Not a prose review - just that each disclosed egress destination is
// named. A destination the wallet contacts and the declaration does not
// mention is the exact shape of an untrue store answer.
// DERIVED FROM THE POLICY, not a list someone remembers to extend. The
// hardcoded six that used to sit here passed while the policy disclosed
// SEVEN hosts this document did not name: the five block-explorer icon
// hosts (no opt-out at all) and the two IPFS/Arweave gateways. That is the
// wrong way round, because the declaration is what a store form gets
// transcribed from, so under-declaring here is how an untrue store answer
// gets filed. Now: every host the policy names must appear here too.
//
// IGNORED, each for a stated reason, because they are not egress:
const NOT_EGRESS = new Map([
    ['xchain.io', 'our own site, named as the policy URL and the wallet website'],
    ['docs.xchain.io', 'our own documentation site, where this policy is published; a link, not a request the wallet makes'],
    ['dankest.llc', 'the publisher, in the contact line'],
    ['github.com', 'the source repository and issue tracker, not something the wallet contacts'],
    ['chrome.storage.local', 'a browser storage API, matched only because it looks like a hostname'],
    ['window.xchain', 'the injected provider object, same reason'],
]);
const HOSTISH = /\b(?:[a-z0-9-]+\.)+(?:io|com|net|org|info|space|llc|local|xchain)\b/g;

// Comments are stripped first, because the rule is about what the policy
// DISCLOSES. The internal status block is maintainer prose that never reaches
// the published page (xchain-websites strips it), so a host named there is not
// a disclosure. This is not hypothetical: recording the mail-deliverability
// evidence for the privacy contact put `aspmx.l.google.com` in that block and
// turned this check red, demanding that a Google MX host be declared as a
// wallet egress destination. Stripping is the right fix rather than another
// ignore-list entry, which would have hidden the class instead of the case.
const publishedPolicy = readFileSync(DOCS.policy, 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');
const policyHosts = [...new Set((publishedPolicy.match(HOSTISH) || []))]
    .filter((h) => !NOT_EGRESS.has(h));

assert.ok(policyHosts.length >= 12,
    `expected the policy to name at least a dozen hosts, found ${policyHosts.length}: `
    + 'if this dropped, the extraction regex stopped matching and the check below is vacuous');

for (const host of policyHosts) {
    assert.ok(record.includes(host),
        `the privacy policy discloses ${host} but the data-collection record does not name it. The `
        + 'declaration is what a store data-safety form gets transcribed from, so a host missing here '
        + 'becomes an untrue store answer. Add it to the egress table.');
}

// The two privacy opt-outs that exist in code must be described, since the
// policy promises them to the user. The published record describes them in
// the user's words rather than by their setting keys (`priceDataEnabled`,
// `metadataFetchEnabled`), so the promise is what is pinned.
for (const [optOut, re] of [
    ['the price / coin-statistics fetch', /price|coin statistics/i],
    ['the token-metadata fetch', /token (?:information|metadata)/i],
]) {
    assert.match(record, re,
        `the data-collection record must describe ${optOut}, which the policy promises is optional`);
}

// The donation feature is not advertising. A form-filler who meets it cold
// will mis-tag it, so the record has to say so in as many words.
assert.match(record, /donation feature is not advertising/i,
    'the data-collection record distinguishes the donation feature from advertising');
assert.ok(/no analytics|Analytics, telemetry and crash reporting/i.test(record),
    'the data-collection record states the no-telemetry position');

// --- 3. The Tor claim, derived from the code ---------------------------

const SRC_ROOTS = ['packages/core/src', 'packages/web/src', 'packages/extension/src',
    'packages/desktop/main', 'packages/desktop/renderer'];

// Where torRouting legitimately appears without being a consumer: the
// settings schema and its migration, the toggle that writes it, the
// Settings flag list, and the diagnostic dump that reports it.
const NON_CONSUMERS = [
    'schemas/settings.js',
    'schemas/migrations.js',
    'settings/PrivacySection.jsx',
    'routes/Settings.jsx',
    'flows/diagnosticDump.js',
];

// Build output is excluded, not just node_modules: a compiled bundle
// contains the PrivacySection toggle's own source and matches every
// pattern below, so scanning dist/ finds the setting being WRITTEN and
// reports it as a consumer. This scan is about source, not artifacts.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'test-results']);

function* walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (/\.(js|jsx|mjs|cjs)$/.test(name)) yield full;
    }
}

const torConsumers = [];
for (const srcRoot of SRC_ROOTS) {
    for (const file of walk(join(root, srcRoot))) {
        const rel = file.slice(root.length + 1);
        if (NON_CONSUMERS.some((n) => rel.endsWith(n))) continue;
        const text = readFileSync(file, 'utf8');
        if (/torRouting|socksProxy|SOCKS5|socks5:\/\//.test(text)) torConsumers.push(rel);
    }
}

//  is IMPLEMENTED, so the direction of this check flips: the
// collateral must now DESCRIBE Tor routing, and must keep saying it is
// desktop-only. If the implementation is ever removed, torConsumers goes
// empty and this fails, telling whoever removed it that three documents
// now promise something the code stopped doing. That is the same bug
// this item was, so the check guards both directions.
assert.ok(torConsumers.length > 0,
    'settings.privacy.torRouting has no consumer again: the published collateral describes Tor routing '
    + 'that no longer exists. Either restore the implementation or remove the claim from all three '
    + 'documents in xchain-documentation.');

for (const [name, text] of Object.entries({
    'data-collection.md': record,
    'privacy-policy.md': policy,
    'export-compliance.md': exportDoc,
})) {
    assert.ok(/Tor/.test(text), `${name} describes the Tor routing option`);
    // The desktop-only limit is the part a form-filler would get wrong,
    // and getting it wrong means telling a store that web and extension
    // users have protection they do not have.
    assert.ok(/desktop/i.test(text),
        `${name} states that Tor routing is desktop-only`);
}
assert.ok(/fail/i.test(record) && /fail/i.test(policy),
    "the collateral states that requests FAIL rather than going direct when the proxy is absent");
// (No "is it still described as inert?" check: the word legitimately
// appears about the unrelated ADS donation placeholder, and a check that
// fires on correct prose about a different feature is one people delete.)

// --- 4. Export stance --------------------------------------------------

assert.ok(/standard, publicly available cryptography/i.test(exportDoc),
    'export-compliance.md states the one-sentence stance');
for (const alg of ['AES-256-GCM', 'Argon2id', 'secp256k1', 'Ed25519']) {
    assert.ok(exportDoc.includes(alg),
        `export-compliance.md names ${alg}`);
}
assert.ok(/legal judgment|compliance decision/i.test(exportDoc),
    'export-compliance.md marks the classification call as a legal judgment, not an engineering one');

console.log('OK: store-submission collateral smoke ( §6c: data declaration, privacy policy, export stance; Tor claim derived from code per )');
