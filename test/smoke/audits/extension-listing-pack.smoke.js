// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §3.4 and §5: the Chrome Web Store listing pack.
//
// THREE documents describe the extension's permissions and its
// content-script reach, and only one of them is executable:
//
//   packages/extension/manifest.json                  <- the truth
//   docs/Privacy_Policy.md, "The browser extension"   <- published to
//                                                        xchain.io
//   packages/extension/docs/STORE_LISTING_PACK.md     <- pasted into the
//                                                        CWS console
//
// The pack is paste-ready text: a justification paragraph per permission,
// the content-script/provider justification, the listing copy. A reviewer
// reads it against the manifest and against the policy, and the CWS form
// requires a justification for EVERY permission. So the failure mode is
// not a broken build, it is a rejection, or worse an accepted listing
// that describes an extension we do not ship.
//
// The manifest-freeze gate (packages/core/scripts/extension-manifest-audit.js)
// already stops an ACCIDENTAL manifest change. It does not help here: a
// DELIBERATE change updates manifest-freeze.json in the same commit and
// sails past, leaving both prose copies silently stale. That is the gap
// this file closes.
//
// Everything is derived from the manifest rather than listed here. A
// hardcoded copy of the permission set is how the sibling check in
// store-collateral.smoke.js passed while the declaration under-declared
// seven hosts (2026-08-01); the same mistake in this file would be worth
// less than nothing, because it would look like coverage.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const PACK_PATH = 'packages/extension/docs/STORE_LISTING_PACK.md';
const POLICY_PATH = 'docs/Privacy_Policy.md';
const MANIFEST_PATH = 'packages/extension/manifest.json';

for (const p of [PACK_PATH, POLICY_PATH, MANIFEST_PATH]) {
    assert.ok(existsSync(join(root, p)), `${p} exists`);
}

const manifest = JSON.parse(read(MANIFEST_PATH));
const packRaw = read(PACK_PATH);
const policyRaw = read(POLICY_PATH);

// HTML comments are maintainer notes in both files, and in the policy's
// case they are stripped before publication. A decision recorded in a
// comment (the D6 note in the pack, the status block in the policy) must
// not satisfy a check about what a reviewer reads.
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, ' ');
const pack = stripComments(packRaw);
const policy = stripComments(policyRaw);

// Split a markdown document into `## ` sections, keyed by heading text.
function sections(text) {
    const out = new Map();
    const parts = text.split(/^## +/m);
    for (const part of parts.slice(1)) {
        const nl = part.indexOf('\n');
        out.set(part.slice(0, nl < 0 ? undefined : nl).trim(), part.slice(nl + 1));
    }
    return out;
}

const packSections = sections(pack);
const policySections = sections(policy);

const findSection = (map, needle) => {
    for (const [title, body] of map) if (title.toLowerCase().includes(needle)) return body;
    return null;
};

const permsSection = findSection(packSections, 'permission justification');
const scriptSection = findSection(packSections, 'content script and injected-provider');
const copySection = findSection(packSections, 'listing copy');
const assetsSection = findSection(packSections, 'listing assets');
const purposeSection = findSection(packSections, 'single-purpose statement');
const extensionSection = findSection(policySections, 'browser extension');

for (const [name, body] of Object.entries({
    'STORE_LISTING_PACK.md "Permission justifications"': permsSection,
    'STORE_LISTING_PACK.md "Content script and injected-provider justification"': scriptSection,
    'STORE_LISTING_PACK.md "Listing copy"': copySection,
    'STORE_LISTING_PACK.md "Listing assets"': assetsSection,
    'STORE_LISTING_PACK.md "Single-purpose statement"': purposeSection,
    'Privacy_Policy.md "The browser extension"': extensionSection,
})) {
    assert.ok(body, `${name} section is present (a rename here makes every check below vacuous)`);
}

// --- 1. Every permission is justified, in both documents ---------------
//
// Both directions. A manifest permission with no paragraph is a form the
// operator has to improvise under review pressure; a paragraph for a
// permission we no longer request tells a reviewer we do something we
// do not, which is the worse half.

// Bold-backticked tokens: `**`storage`**` in the pack, `- **`storage`**`
// in the policy bullet list.
const boldTokens = (text) => [...text.matchAll(/\*\*`([A-Za-z_]+)`\*\*/g)].map((m) => m[1]);

// Manifest keys that are legitimately justified alongside the permissions
// because the CWS form asks about them, but which are not entries in
// `permissions[]`.
const NON_PERMISSION_KEYS = new Set(['web_accessible_resources', 'host_permissions']);

const declared = manifest.permissions ?? [];
assert.ok(declared.length >= 1, 'the manifest declares at least one permission');

const packJustified = new Set(boldTokens(permsSection));
const policyJustified = new Set(boldTokens(extensionSection));

for (const perm of declared) {
    assert.ok(packJustified.has(perm),
        `manifest declares "${perm}" but ${PACK_PATH} has no justification paragraph for it. `
        + 'The CWS form requires one per permission; a missing paragraph gets improvised at the console.');
    assert.ok(policyJustified.has(perm),
        `manifest declares "${perm}" but ${POLICY_PATH} ("The browser extension") does not describe it. `
        + 'A reviewer reads the two against each other, and the policy is the published one.');
}

for (const [label, justified] of [[PACK_PATH, packJustified], [POLICY_PATH, policyJustified]]) {
    for (const token of justified) {
        if (NON_PERMISSION_KEYS.has(token)) continue;
        assert.ok(declared.includes(token),
            `${label} justifies "${token}", which the manifest does not declare. Either the permission was `
            + 'removed and the prose was left behind (it now describes an extension we do not ship), or the '
            + 'token is a new manifest key that belongs in NON_PERMISSION_KEYS here.');
    }
}

// --- 2. host_permissions -----------------------------------------------
//
// Empty today, and both documents lean on that as a selling point. If it
// ever becomes non-empty, the claim becomes false and each host needs its
// own justification, so the check flips rather than being deleted.

const hostPerms = manifest.host_permissions ?? [];
const noHostClaim = /requests?\s+\*\*no\*\*\s+`host_permissions`|no\s+`?host_permissions`?/i;

if (hostPerms.length === 0) {
    assert.ok(noHostClaim.test(policy),
        `${POLICY_PATH} no longer states that the extension requests no host_permissions. That claim is `
        + 'true and is the strongest thing the extension can say to a reviewer; do not drop it silently.');
} else {
    assert.ok(!noHostClaim.test(policy),
        `manifest now requests host_permissions (${hostPerms.join(', ')}), but ${POLICY_PATH} still claims `
        + 'it requests none. That is a false statement on a published page.');
    for (const host of hostPerms) {
        assert.ok(permsSection.includes(host),
            `manifest requests host permission "${host}" with no justification in ${PACK_PATH}. `
            + 'Host permissions are the single most scrutinised field on a wallet listing.');
    }
}

// --- 3. The match lists agree with the manifest ------------------------
//
// D6 (2026-07-31) narrowed the content script to secure origins plus
// loopback, and the paste-ready paragraphs quote that list literally. If
// the decision is ever revisited, the manifest moves and this prose does
// not, and what gets pasted into the console is then a description of an
// extension that does not exist. That is not a hypothetical class: the
// same edit already broke an e2e spec whose dApp origin nobody had
// re-read (spec §8 D6).

// Backticked URLs carrying a wildcard, which is what a Chrome match
// pattern looks like. The wildcard is the filter: without it, an ordinary
// example URL in a sentence ("a page at `https://app.example.com` calls
// the provider") would read as a declared match and turn this red for
// nothing. The assertion below closes the hole that filter opens.
const MATCH_PATTERN = /`(https?:\/\/[^`\s]*\*[^`\s]*)`/g;
const matchesIn = (text) => new Set([...text.matchAll(MATCH_PATTERN)].map((m) => m[1]));

const manifestMatches = new Set(
    (manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? []));
assert.ok(manifestMatches.size >= 1, 'the manifest declares content-script matches');
for (const m of manifestMatches) {
    assert.ok(m.includes('*'),
        `the manifest declares a content-script match without a wildcard ("${m}"). The prose extraction `
        + 'here keys on the wildcard to tell match patterns apart from example URLs, so it would not see '
        + 'this one. Widen MATCH_PATTERN before shipping that match.');
}

// The pack quotes the list in the §2 heading for the content script and
// again in the §3 blockquote a reviewer actually receives. Both count.
const csHeading = permsSection.match(/^\*\*Content script \(([^)]*)\)\*\*/m);
assert.ok(csHeading, `${PACK_PATH} §2 has no "**Content script (...)**" heading quoting the match list`);

const quoted = {
    [`${PACK_PATH} §2 content-script heading`]: matchesIn(csHeading[1]),
    [`${PACK_PATH} §3 justification`]: matchesIn(scriptSection),
    [`${POLICY_PATH} "The browser extension"`]: matchesIn(extensionSection),
};

const sorted = (s) => [...s].sort().join(', ');
for (const [label, found] of Object.entries(quoted)) {
    assert.deepEqual(sorted(found), sorted(manifestMatches),
        `${label} quotes the content-script match list as [${sorted(found)}] but the manifest declares `
        + `[${sorted(manifestMatches)}]. Widening or narrowing the matches is a change to all three `
        + 'documents; the store form and the published policy both describe this reach in words.');
}

// --- 4. The listing copy fits the fields it goes into ------------------
//
// The store truncates a summary over 132 characters. The pack states its
// own measured count, which is exactly the kind of number that stops
// being true when someone edits the sentence, so it is re-measured here
// rather than trusted.

const summaryHeading = copySection.match(/\*\*132-character summary \((\d+) characters?, limit (\d+)\)/);
assert.ok(summaryHeading, `${PACK_PATH} §4 has no "**132-character summary (N characters, limit M):**" heading`);

const summaryBody = copySection.slice(copySection.indexOf(summaryHeading[0]));
const summaryQuote = summaryBody.match(/^> (.+)$/m);
assert.ok(summaryQuote, `${PACK_PATH} §4 states a summary length but has no blockquote holding the summary`);

const summary = summaryQuote[1].trim();
const limit = Number(summaryHeading[2]);
assert.equal(limit, 132, 'the CWS summary limit is 132 characters');
assert.ok(summary.length <= limit,
    `the listing summary is ${summary.length} characters, over the ${limit}-character CWS limit. `
    + 'The store truncates it mid-sentence rather than rejecting it, so nothing else would notice.');
assert.equal(summary.length, Number(summaryHeading[1]),
    `${PACK_PATH} §4 claims the summary is ${summaryHeading[1]} characters; it measures ${summary.length}. `
    + 'Re-count it in the heading, or the next person trusts a stale number at the console.');

// The listing name is the manifest's `name`: CWS takes the title from the
// package, so a pack that names something else describes a listing that
// cannot exist.
const nameLine = copySection.match(/^\*\*Name:\*\* *([^(\n]+)/m);
assert.ok(nameLine, `${PACK_PATH} §4 has no "**Name:**" row`);
assert.equal(nameLine[1].trim(), manifest.name,
    `${PACK_PATH} §4 names the listing "${nameLine[1].trim()}" but manifest.json ships name `
    + `"${manifest.name}". The store takes the listing title from the package, so these cannot differ.`);

// --- 5. The single purpose is one statement, not two -------------------
//
// The pack pastes it into the console field and the policy publishes it.
// Not compared verbatim: the policy addresses the reader as "you" and the
// pack describes "a user", and a check that forced identical wording
// would be satisfied by making the published policy read like a form
// field. Compared on the claims a reviewer cross-checks instead.

const policyPurpose = policy.match(/\*\*Single purpose\.\*\*([^\n]+)/);
assert.ok(policyPurpose, `${POLICY_PATH} carries no "**Single purpose.**" statement`);
const packPurpose = purposeSection.match(/^> (.+)$/m);
assert.ok(packPurpose, `${PACK_PATH} §1 has no blockquote holding the single-purpose statement`);

for (const claim of ['bitcoin', 'dogecoin', 'litecoin', 'self-custodial', 'sign']) {
    assert.ok(packPurpose[1].toLowerCase().includes(claim),
        `the pack's single-purpose statement does not mention "${claim}"`);
    assert.ok(policyPurpose[1].toLowerCase().includes(claim),
        `the policy's single-purpose statement does not mention "${claim}", so the two disagree about `
        + 'what the extension is for. A reviewer reads both.');
}

// --- 6. The listing assets exist at the sizes claimed ------------------
//
// The pack states each asset's pixel dimensions, measured by hand with
// `sips` at capture time (macOS only, so not something CI could repeat).
// A regenerated screenshot at the wrong viewport is rejected by the store
// upload form, days into a review clock. Dimensions are read here from
// the PNG header directly, which works anywhere Node runs.

function pngSize(absPath) {
    const fd = openSync(absPath, 'r');
    try {
        const buf = Buffer.alloc(24);
        const bytes = readSync(fd, buf, 0, 24, 0);
        assert.equal(bytes, 24, `${absPath} is too short to be a PNG`);
        assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
            `${absPath} is not a PNG`);
        assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR',
            `${absPath} does not start with an IHDR chunk`);
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    } finally {
        closeSync(fd);
    }
}

const assetLines = assetsSection.split('\n').filter((l) => /listing-assets\/[^\s`]+\.png/.test(l));
assert.ok(assetLines.length >= 4,
    `expected at least 4 listing assets in ${PACK_PATH} §5 (3 screenshots + promo tile), found `
    + `${assetLines.length}: if this dropped, the extraction stopped matching and the checks below are vacuous`);

let dimensionsChecked = 0;
for (const line of assetLines) {
    const rel = line.match(/(packages\/extension\/docs\/listing-assets\/[^\s`,]+\.png)/)[1];
    assert.ok(existsSync(join(root, rel)),
        `${PACK_PATH} §5 references ${rel}, which does not exist. The listing pack is the upload manifest; `
        + 'a missing asset is found at the console, not here, unless this check finds it first.');

    // Read the claim from the PROSE, with the path cut out first. One
    // asset is named `promo-tile-440x280.png`, so matching the whole line
    // finds a size in the filename and reports a row as checked even when
    // the sentence states nothing (caught by mutation: deleting the stated
    // size from that row left this green).
    const stated = line.replace(rel, '').match(/\b(\d{3,4})x(\d{3,4})\b/);
    if (!stated) continue;
    const { width, height } = pngSize(join(root, rel));
    assert.equal(`${width}x${height}`, `${stated[1]}x${stated[2]}`,
        `${rel} is ${width}x${height} but ${PACK_PATH} §5 states ${stated[1]}x${stated[2]}. The CWS upload `
        + 'form rejects a wrongly-sized asset, so a regenerated screenshot at a changed viewport blocks a '
        + 'submission that is otherwise ready.');
    dimensionsChecked += 1;
}
assert.ok(dimensionsChecked >= 4,
    `only ${dimensionsChecked} listing assets state their dimensions; expected at least 4. An asset row `
    + 'without a stated size is unchecked, which defeats the point of stating them.');

console.log(`OK: extension listing-pack smoke ( §3.4/§5: ${declared.length} permissions justified in both `
    + `documents, ${manifestMatches.size} content-script matches agreeing across three files, summary `
    + `${summary.length}/${limit} chars, ${dimensionsChecked} assets at the stated sizes)`);
