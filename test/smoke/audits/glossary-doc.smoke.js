// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §55 / G179: the wallet glossary.
//
//  moved it to the sibling xchain-documentation checkout
// (components/wallet/glossary.md), published at
// https://docs.xchain.io/components/wallet/glossary. The vocabulary it
// pins is this codebase's, so the assertions followed it across rather
// than being dropped; the gate skips, loudly, without that checkout.
//
// Pins the canonical wallet vocabulary so the doc cannot drift far
// from the codebase. Every term checked here is one a contributor
// or integrator might search for; missing one is a real gap, not a
// taste call.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsPath, skipUnlessDocs } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

skipUnlessDocs('glossary-doc smoke');

const docPath = docsPath('glossary.md');
assert.ok(existsSync(docPath), `${docPath} exists`);

const docSrc = readFileSync(docPath, 'utf8');

// Required structural sections (keep the partition stable).
const requiredSections = [
    '## Wallet architecture',
    '## Signing and key management',
    '## dApp bridge',
    '## Storage and state',
    '## Onboarding and recovery',
    '## Build and release',
];
for (const heading of requiredSections) {
    assert.ok(docSrc.includes(heading),
        `glossary has section: ${heading}`);
}

// Required terms: anything below is a term the codebase actively
// uses. Each must have a bold-prefixed definition line.
const requiredTerms = [
    // Architecture. 'three-shell model' was dropped when the glossary became
    // a public page: it is a repo-internal way of describing the layout, and
    // the terms it is built from ('core', 'shell') are still defined.
    'core', 'shell', 'vault', 'flow',
    'MessageHost', 'messaging shim',
    // Signing
    'HD wallet', 'imported WIF', 'BIP39 passphrase',
    'signer', 'SignerPool', 'panic mode', 'clipboard auto-clear',
    // Bridge
    'bridge', 'ConnectedSite', 'approval', 'bridge error code',
    'throttle', 'blocklist', 'SIWX',
    // Storage
    'Wallet record', 'Account', 'Address record', 'Settings record',
    'v2-tolerant', 'ConnectedSites collection', 'ADS',
    // Onboarding
    'onboarding', 'dry-run restore', 'word-quiz',
    'backup reminder', 'demo mode',
    // Build. 'spec gap ledger' and 'cluster' were dropped for the same
    // reason: they name this repo's own planning artifacts, not anything a
    // contributor or integrator meets in the product or the bridge.
    'reproducible build', 'synchronized versioning',
    'RELEASE_HASHES.txt', 'smoke',
];
// Separator: a hyphen, a colon, or (legacy) the long dash. The glossary used the
// long dash until the repo-wide de-em-dash pass rewrote every entry to a hyphen;
// this smoke still only accepted the old two, so all 45 terms "failed" while the
// doc was perfectly well-formed. Accept the house style.
for (const term of requiredTerms) {
    const escaped = term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`\\*\\*${escaped}\\*\\*\\s*([-:\u2014])`);
    assert.ok(re.test(docSrc),
        `glossary defines: **${term}** (followed by definition separator)`);
}

// Cross-link to the platform's protocol glossary so the wallet doc does not
// duplicate ACTION / encoding-type / etc. Now a relative link inside the
// docs repo rather than a repo name in prose.
assert.ok(/key-terms\.md/.test(docSrc),
    'glossary cross-links the platform key-terms glossary');

// Cross-links to companion wallet docs that the glossary references must
// resolve. They are siblings inside the docs repo now, so the link and the
// file are checked in the same place.
const companions = [
    'reproducible-builds.md',
    'bridge.md',
];
for (const linkPath of companions) {
    assert.ok(docSrc.includes(`(${linkPath})`),
        `glossary references ${linkPath}`);
    assert.ok(existsSync(docsPath(linkPath)),
        `companion exists: ${linkPath}`);
}

// The doc used to close with an invitation to open a PR for a missing term.
// That line was a contributor-repo convention and did not survive the move to
// a published documentation site, so there is nothing left to assert here.

console.log('OK: wallet glossary doc smoke');
