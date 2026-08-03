// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every egress host that happens on SOME shells and not others must say so
// where it is disclosed. `wireAudit.js` is the source: a row's `shells` field
// is the truth about which shells make the request, and the privacy policy and
// the data-collection record are the two documents all three store forms are
// transcribed from.
//
//  S21 found the failure this closes. All five block-explorer hosts
// carry `shells: ['extension']`, for a structural reason (the extension ships
// no `content_security_policy` key, so MV3's default leaves `img-src`
// unrestricted, while every other shell injects the §51 CSP). The iOS
// nutrition labels said extension-only and cited that reason. The Chrome data
// disclosure said extension-only, because S15 derives it from
// `egressHostsFor('extension')`. The policy and the record named no shell at
// all, so the public document the Chrome store form validates claimed an
// all-shell contact the code makes on one shell, and the iOS labels then read
// as contradicting the policy of the same product.
//
// That is §3.3's rejection cause (a policy that disagrees with the
// data-disclosure answers) arriving in the OVERSTATING direction, which is the
// direction nobody looks for. It survived because S15 derived the extension's
// own form from the code and nothing derived the two PARENT documents.
//
// Scoped deliberately, in the S14 tradition of not firing on correct writing:
//   - Only hosts whose `shells` is a strict subset of SHELLS are checked. A
//     host every shell contacts has no scope to state.
//   - Only where the document actually NAMES the host. Neither document is
//     obliged to mention every host.
//   - Only DISCLOSURE passages, identified by the documents' own house style:
//     a bold lead-in paragraph (`**Block-explorer icons...**`) in the policy,
//     or a table row in the record. This is not a nicety. The policy also
//     names `downloads.xchain.io` in a paragraph about which addresses our
//     servers write to their logs, alongside three sibling hosts; that
//     passage discloses no per-shell contact and naming a shell in it would
//     be wrong, so an unscoped rule fires on prose that is already correct.
//   - The shell may be named by the passage OR by the section heading above
//     it, because the policy is organised into per-shell sections
//     ("## The desktop app", "## The Android app") and repeating the shell
//     inside every paragraph under them would be worse writing. Hosts
//     disclosed in the shared "What leaves your device" section have no such
//     heading and must name their shells inline, which is exactly what the
//     Trezor paragraph beside the block-explorer one already does.
// Failing any of those, this would fire on prose that is already right, and a
// check that fires on correct writing is one people delete.

import assert from 'node:assert/strict';

import { WIRE_AUDIT, SHELLS } from '../../../packages/core/src/privacy/wireAudit.js';
import { readDoc, skipUnlessDocs } from '../_docs-repo.js';

skipUnlessDocs('privacy shell-scope smoke');

// How each shell may legitimately be named in plain-language prose. The
// policy is written for wallet users, not for the shell identifiers, so
// "phone apps" has to count as naming `mobile`.
const SHELL_PHRASES = {
    web: ['web wallet', 'web app', 'in the browser at'],
    desktop: ['desktop app', 'desktop wallet', 'desktop'],
    extension: ['browser extension', 'extension'],
    mobile: ['phone app', 'mobile app', 'android', 'ios', 'phone'],
};

for (const shell of SHELLS) {
    assert.ok(SHELL_PHRASES[shell]?.length,
        `wireAudit declares the shell "${shell}" but this check has no plain-language phrasing for `
        + 'it, so it could never verify a document that scopes a host to that shell. Add the '
        + 'phrasings this repo actually uses in prose.');
}

const restricted = WIRE_AUDIT.filter((e) => e.host !== '*' && e.shells.length < SHELLS.length);

assert.ok(restricted.length > 0,
    'no shell-restricted egress rows found in wireAudit.js. Either every host is now contacted by '
    + 'every shell (in which case this check is obsolete and should be deleted deliberately) or the '
    + 'audit shape changed and every assertion below is vacuous.');

/**
 * Disclosure passages naming a host, each paired with the section heading in
 * force where it appears. A passage is a disclosure when the document's own
 * house style says so: a bold lead-in paragraph, or a table row.
 *
 * @returns {Array<{ text: string, heading: string }>}
 */
function disclosuresNaming(text, host) {
    const out = [];
    let heading = '';

    for (const block of text.split(/\n\s*\n/)) {
        const headingLine = [...block.matchAll(/^#{1,6}\s+(.*)$/gm)].pop();
        if (headingLine) heading = headingLine[1];

        // Table rows stand alone; each row is its own disclosure.
        const units = block.startsWith('|') ? block.split('\n') : [block];

        for (const unit of units) {
            if (!unit.includes(host)) continue;
            const isRow = unit.startsWith('|');
            const isBoldLed = /^\s*\*\*/.test(unit);
            if (!isRow && !isBoldLed) continue;      // infrastructure prose, not a disclosure
            out.push({ text: unit, heading });
        }
    }
    return out;
}

const DOCS = [
    ['privacy/privacy-policy.md', readDoc('privacy/privacy-policy.md')],
    ['privacy/data-collection.md', readDoc('privacy/data-collection.md')],
];

let checked = 0;
let skippedUnnamed = 0;

for (const [docName, text] of DOCS) {
    for (const entry of restricted) {
        const passages = disclosuresNaming(text, entry.host);
        if (passages.length === 0) { skippedUnnamed += 1; continue; }

        const phrases = entry.shells.flatMap((s) => SHELL_PHRASES[s]);

        for (const passage of passages) {
            checked += 1;
            const lower = `${passage.heading}\n${passage.text}`.toLowerCase();
            const named = phrases.some((p) => lower.includes(p));

            assert.ok(named,
                `${docName} names ${entry.host} without saying which shell makes the request. `
                + `wireAudit.js scopes it to ${entry.shells.join(', ')} `
                + `(${entry.source}), and this document is the one the store privacy forms are `
                + 'transcribed from and the Chrome submission form validates. An unscoped '
                + 'disclosure of a shell-specific contact overstates what the other shells do, '
                + 'which contradicts the per-shell store forms and is a listing-rejection cause '
                + `in its own right. Name one of: ${phrases.join(', ')}.`);
        }
    }
}

assert.ok(checked > 0,
    `${restricted.length} shell-restricted hosts are declared in wireAudit.js and not one of them is `
    + 'named in either privacy document, so this check passed without checking anything. That is '
    + 'either a porting accident or a real disclosure gap; both want a human.');

console.log(`OK: privacy shell-scope smoke ( S21: ${restricted.length} shell-restricted hosts `
    + `from wireAudit.js, ${checked} disclosure passages scoped correctly across ${DOCS.length} `
    + `documents, ${skippedUnnamed} host/document pairs not named and so not applicable)`);
