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
// shared (one wallet, one data posture), so it is written once in
// docs/Data_Collection.md and transcribed. This smoke exists because
// the failure mode for that collateral is silent: prose rots against
// code with nothing to notice, and the thing you find out later is
// that you declared something untrue to a store.
//
// Two checks earn their keep here.
//
// 1. A draft cannot lose its banner while it still has holes in it.
//    A privacy policy with [UNSETTLED] markers and no DRAFT warning is
//    one careless copy-paste away from being published as final.
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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const DOCS = {
    record: 'docs/Data_Collection.md',
    policy: 'docs/Privacy_Policy.md',
    export: 'docs/Export_Compliance.md',
};

for (const p of Object.values(DOCS)) {
    assert.ok(existsSync(join(root, p)), `${p} exists`);
}

// The docs index has to name them, or nobody filling in a store form
// finds the file they were supposed to transcribe.
const docsIndex = read('docs/README.md');
for (const p of Object.values(DOCS)) {
    const base = p.replace('docs/', '');
    assert.ok(docsIndex.includes(base), `docs/README.md indexes ${base}`);
}

// Collapse whitespace before matching prose. These files are hard
// wrapped, so any phrase long enough to be worth asserting on will
// eventually straddle a line break, and a check that breaks when
// someone rewraps a paragraph trains people to delete the check.
const flat = (p) => read(p).replace(/\s+/g, ' ');

const record = flat(DOCS.record);
const policy = flat(DOCS.policy);
const exportDoc = flat(DOCS.export);

// --- 1. A draft with holes keeps its banner ----------------------------

for (const [name, text] of Object.entries({
    'Data_Collection.md': record,
    'Privacy_Policy.md': policy,
    'Export_Compliance.md': exportDoc,
})) {
    if (/\[UNSETTLED/.test(text) || /Unsettled: needs an operator answer/.test(text)) {
        assert.ok(/DRAFT/.test(text),
            `${name} still has unsettled facts, so it must carry a DRAFT marker`);
    }
}

// The policy is the one that gets published, so it says out loud that it
// is not ready and names where the missing facts are tracked.
assert.ok(/not yet publishable/i.test(policy),
    'Privacy_Policy.md states it is not publishable while facts are unsettled');
assert.ok(policy.includes('Data_Collection.md'),
    'Privacy_Policy.md points at its source of record');

// --- 2. The declaration must cover what the code actually does ---------
//
// Not a prose review - just that each disclosed egress destination is
// named. A destination the wallet contacts and the declaration does not
// mention is the exact shape of an untrue store answer.
for (const host of [
    'explorer.xchain.io',
    'encoder.xchain.io',
    'hub.xchain.io',
    'downloads.xchain.io',
    'api.coingecko.com',
    'connect.trezor.io',
]) {
    assert.ok(record.includes(host),
        `Data_Collection.md names the egress destination ${host}`);
}

// The two privacy opt-outs that exist in code must be named, since the
// policy promises them to the user.
for (const setting of ['priceDataEnabled', 'metadataFetchEnabled']) {
    assert.ok(record.includes(setting),
        `Data_Collection.md names the ${setting} opt-out`);
}

// "ADS" is Automatic Donation System, not advertising. A form-filler who
// meets the acronym cold will mis-tag it, so the record has to say so.
assert.ok(/Automatic Donation System/.test(record),
    'Data_Collection.md disambiguates ADS from advertising');
assert.ok(/no analytics|Analytics, telemetry and crash reporting/i.test(record),
    'Data_Collection.md states the no-telemetry position');

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
    "settings.privacy.torRouting has no consumer again: the collateral in "
    + "docs/ describes Tor routing that no longer exists. Either restore the "
    + "implementation or remove the claim from all three documents.");

for (const [name, text] of Object.entries({
    "Data_Collection.md": record,
    "Privacy_Policy.md": policy,
    "Export_Compliance.md": exportDoc,
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
    'Export_Compliance.md states the one-sentence stance');
for (const alg of ['AES-256-GCM', 'Argon2id', 'secp256k1', 'Ed25519']) {
    assert.ok(exportDoc.includes(alg),
        `Export_Compliance.md names ${alg}`);
}
assert.ok(/legal judgment|compliance decision/i.test(exportDoc),
    'Export_Compliance.md marks the classification call as a legal judgment, not an engineering one');

console.log('OK: store-submission collateral smoke ( §6c: data declaration, privacy policy, export stance; Tor claim derived from code per )');
