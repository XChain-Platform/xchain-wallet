// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §55 / G179: `docs/GLOSSARY.md`.
//
// Pins the canonical wallet vocabulary so the doc cannot drift far
// from the codebase. Every term checked here is one a contributor
// or integrator might search for; missing one is a real gap, not a
// taste call.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const docPath = 'docs/GLOSSARY.md';
assert.ok(existsSync(join(root, docPath)), `${docPath} exists`);

const docSrc = read(docPath);

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
    // Architecture
    'core', 'shell', 'three-shell model', 'vault', 'flow',
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
    // Build
    'reproducible build', 'synchronized versioning',
    'RELEASE_HASHES.txt', 'smoke', 'spec gap ledger', 'cluster',
];
for (const term of requiredTerms) {
    const escaped = term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`\\*\\*${escaped}\\*\\*\\s*([\u2014:])`);
    assert.ok(re.test(docSrc),
        `glossary defines: **${term}** (followed by definition separator)`);
}

// Cross-link to upstream protocol glossary so the wallet doc does not
// duplicate ACTION / encoding-type / etc.
assert.ok(/xchain-documentation/.test(docSrc) && /Key_Terms\.md/.test(docSrc),
    'glossary cross-links upstream xchain-documentation/Key_Terms.md');

// Cross-links to companion wallet docs that the glossary references
// must exist (REPRODUCIBLE_BUILDS, BRIDGE).
const companions = [
    'docs/Reproducible_Builds.md',
    'docs/BRIDGE.md',
];
for (const linkPath of companions) {
    assert.ok(docSrc.includes(linkPath),
        `glossary references ${linkPath}`);
    assert.ok(existsSync(join(root, linkPath)),
        `companion exists: ${linkPath}`);
}

// Honest framing about staleness: glossaries that fall behind the
// codebase are worse than no glossary, so the doc itself flags this.
assert.ok(/PR adding it/i.test(docSrc),
    'glossary invites PRs for missing terms (anti-staleness)');

console.log('OK: GLOSSARY.md doc smoke');
