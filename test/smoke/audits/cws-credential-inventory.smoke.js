/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

// test/smoke/audits/cws-credential-inventory.smoke.js - the Chrome Web Store
// API credential has a key-inventory row of its own, with custody, rotation
// and compromise rules, before one is ever issued.
//
// WHY A TEST FOR A PARAGRAPH IN A SPEC.
//
// `cws-upload.smoke.js` guards the tool's refusals. This guards the thing the
// tool cannot: the credential it consumes. A refresh token that can publish to
// the Chrome Web Store is functionally the publisher account, which is the
// tool's own stated reason for existing, and for three days after the tool
// landed that credential had no K-row in `claude/specs/wallet-release-rails.md`
// §4 - no custody rule, no rotation owner, no compromise story. It was not
// forgotten by accident: the closing row that built the tool SAID the
// credential joins the key inventory as a real K-row, and nothing read that
// sentence afterwards. A prose promise nobody measures is how it happened, so
// the fix is measured rather than promised.
//
// Every assertion here is derived from a source rather than copied from the
// spec: the environment variable names come out of `cws-upload.mjs`, and the
// row is found by which row NAMES the tool, not by its number. A check that
// hardcodes `K20` passes the day someone deletes the row and renumbers.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = join(here, '..', '..', '..');

const TOOL = join(walletRoot, 'tools', 'release', 'cws-upload.mjs');
const SPEC = process.env.XCHAIN_WALLET_RELEASE_RAILS_SPEC
    || join(walletRoot, '..', 'claude', 'specs', 'wallet-release-rails.md');

if (!existsSync(TOOL)) {
    console.log(`SKIP cws-credential-inventory.smoke.js: no upload tool at ${TOOL}, so there is no `
        + 'credential for the inventory to owe a row to.');
    process.exit(0);
}

if (!existsSync(SPEC)) {
    console.log(`SKIP cws-credential-inventory.smoke.js: the rails spec is not in this checkout `
        + `(expected at ${SPEC}). Check the platform repo out above this one, or set `
        + 'XCHAIN_WALLET_RELEASE_RAILS_SPEC, to run it.');
    process.exit(0);
}

/** The `CWS_*` names the tool actually reads, taken from the tool. */
function credentialEnvNames(toolSource) {
    const found = new Set(toolSource.match(/\bCWS_[A-Z0-9_]+\b/g) || []);
    return [...found].sort();
}

/** §4 of the rails spec, table and policy prose alike. */
function keyInventorySection(spec) {
    const start = spec.search(/^## 4\. /m);
    assert.notEqual(start, -1, 'the rails spec still has a §4 key inventory');
    const rest = spec.slice(start + 1);
    const end = rest.search(/^## \d+\. /m);
    return end === -1 ? spec.slice(start) : spec.slice(start, start + 1 + end);
}

/** Every `| Kn | ... |` row of §4, as named cells. */
function keyRows(section) {
    const rows = [];
    for (const line of section.split('\n')) {
        const m = /^\|\s*(K\d+)\s*\|/.exec(line);
        if (!m) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        rows.push({
            id: m[1], line, cells, credential: cells[1] || '', unlocks: cells[2] || '',
            consumedBy: cells[3] || '', lossStory: cells[4] || '',
        });
    }
    return rows;
}

/**
 * The `**Kn policy.**` paragraph plus the bullet list under it. Scoped by
 * structure rather than by a line count, so adding a bullet cannot silently
 * drop half the block out of the assertions below.
 */
function policyBlock(section, id) {
    const paras = section.split(/\n\s*\n/);
    const first = paras.findIndex((p) => p.startsWith(`**${id} policy`));
    if (first === -1) return '';
    const block = [paras[first]];
    for (let i = first + 1; i < paras.length && paras[i].trimStart().startsWith('- '); i += 1) {
        block.push(paras[i]);
    }
    return block.join('\n\n');
}

const tool = readFileSync(TOOL, 'utf8');
const spec = readFileSync(SPEC, 'utf8');
const section = keyInventorySection(spec);
const rows = keyRows(section);

// (a) The credential has a row of its own, found by what consumes it.
const apiRows = rows.filter((r) => /cws-upload/.test(r.consumedBy));
assert.equal(apiRows.length, 1,
    'exactly one §4 row names cws-upload.mjs as its consumer; found '
    + `${apiRows.length} (${apiRows.map((r) => r.id).join(', ') || 'none'}). The Chrome Web Store `
    + 'API credential can publish to the store, so it is a key and needs a key row');
const api = apiRows[0];
assert.notEqual(api.id, 'K7',
    'the API credential is not the K7 human account row: a bearer token that bypasses that '
    + "account's hardware key fails differently and rotates on different triggers");

// (b) The row describes the credential the tool really reads. Derived from the
//     tool, so renaming an environment variable there fails here rather than
//     leaving the inventory describing a credential that no longer exists.
const envNames = credentialEnvNames(tool);
assert.ok(envNames.length >= 3,
    `cws-upload.mjs should read at least three CWS_* values; parsed ${envNames.length}`);
for (const name of envNames) {
    assert.ok(api.line.includes(name),
        `§4 row ${api.id} names \`${name}\`, which cws-upload.mjs reads`);
}

// (c) The compromise story is on the row, not left to be re-derived. The
//     shortest real answer here is long: the loss story has to say what a
//     holder can do and what revoking costs.
assert.ok(api.lossStory.length >= 200,
    `§4 row ${api.id} carries a real loss story, not a placeholder (got `
    + `${api.lossStory.length} characters)`);
assert.ok(/revok/i.test(api.lossStory),
    `§4 row ${api.id}'s loss story says what revocation does, which is the whole reason this `
    + 'credential is milder than K7');

// (d) Custody, rotation owner and compromise, the three fields the row was
//     registered for, written down where a reader looks them up.
const policy = policyBlock(section, api.id);
assert.ok(policy, `§4 carries a \`**${api.id} policy**\` block`);
for (const [label, re] of [
    ['custody', /custody/i],
    ['rotation', /rotat/i],
    ['compromise', /compromise/i],
]) {
    assert.ok(re.test(policy), `the ${api.id} policy block states its ${label} rule`);
}
const rotation = (policy.match(/^- \*\*Rotation[^\n]*(?:\n(?!- ).*)*/mi) || [''])[0];
assert.ok(/operator/i.test(rotation),
    `the ${api.id} rotation rule names its owner, and the owner is the operator: minting is a `
    + 'consent flow under the publisher identity that no agent can or should complete');

// (e) The stale K7 wording is gone. This is the exact sentence the finding was
//     filed against: K7's consumer column read "manual upload, later CWS API
//     refresh token", written before the tool existed and left standing after
//     it shipped.
const k7 = rows.find((r) => r.id === 'K7');
assert.ok(k7, '§4 still has a K7 Chrome Web Store account row');
assert.ok(!/later CWS API refresh token/i.test(k7.line),
    "K7's consumer column no longer promises the API path as a future thing: the tool is built "
    + `and the credential is ${api.id}`);
assert.ok(k7.line.includes(api.id),
    `K7 points at ${api.id} so a reader arriving at the account row learns the API path is a `
    + 'separate credential rather than covered by these rules');

console.log(`PASS cws-credential-inventory.smoke.js (${api.id} carries custody, rotation and `
    + `compromise for ${envNames.join(', ')})`);
