// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / Cluster T FOLLOWUPs 4 + 5: governance section in
// CONTRIBUTING.md + per-section documentation parity check in
// QA-CHECKLIST.md.
//
// Pins:
//   - CONTRIBUTING.md has a Governance section that links to
//     MAINTAINERS.md.
//   - The MAINTAINERS.md file actually exists (the link can't dangle).
//   - The manual QA checklist has a "Documentation parity check" section
//     covering the major docs (architecture, bridge, reproducible builds,
//     verify-release, glossary, threat model, maintainers, security,
//     contributor process, code of conduct).
//
// a later change moved the checklist, and the docs it covers, into the sibling
// xchain-documentation checkout, so the parity half skips when that checkout
// is absent. The CONTRIBUTING.md half is in this repo and always runs.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsAvailable, docsPath, WALLET_DOCS } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const contributing = readFileSync(join(wsRoot, 'CONTRIBUTING.md'), 'utf8');

// --- 1. CONTRIBUTING.md governance ----------------------------------------

assert.match(contributing, /^## Governance$/m,
    'CONTRIBUTING.md has a Governance section');
assert.match(
    contributing,
    /\[`MAINTAINERS\.md`\]\(\.\/MAINTAINERS\.md\)/,
    'Governance section cross-links to MAINTAINERS.md',
);
assert.match(
    contributing,
    /lazy consensus|tiebreak/i,
    'Governance section explains the decision-making model',
);

assert.ok(existsSync(join(wsRoot, 'MAINTAINERS.md')),
    'the MAINTAINERS.md the governance section links to actually exists');

// --- 2. Manual QA checklist, per-section docs check ----------------------

if (!docsAvailable()) {
    console.log('SKIP (partial): docs-governance-checklist smoke - the CONTRIBUTING.md '
        + 'half passed, but the documentation-parity half needs the sibling '
        + `xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
    process.exit(0);
}

const qaChecklist = readFileSync(docsPath('release', 'qa-checklist.md'), 'utf8');

assert.match(qaChecklist, /^## Documentation parity check$/m,
    'the QA checklist has a Documentation parity check section');

// The checklist names each doc in prose rather than by filename, so this
// pins the SUBJECT of each row, not a path. A row that stops covering one
// of these is the drift worth catching.
const subjectsToCover = [
    /Architecture documentation/i,
    /Bridge documentation/i,
    /Reproducible-builds documentation/i,
    /Verify a release/i,
    /Glossary/i,
    /Threat model/i,
    /Maintainer and escalation contacts/i,
    /Security disclosure contact/i,
    /Contributor-facing process documentation/i,
    /Code of conduct/i,
];
for (const subject of subjectsToCover) {
    assert.match(qaChecklist, subject,
        `parity check covers ${subject}`);
}

// And each doc should actually exist so the checklist isn't asking the user
// to verify a phantom. The prose docs are in the sibling checkout; the
// governance and disclosure files stayed in this repo.
const docPaths = {
    'architecture.md': docsPath('architecture.md'),
    'bridge.md': docsPath('bridge.md'),
    'reproducible-builds.md': docsPath('reproducible-builds.md'),
    'release/verify-release.md': docsPath('release', 'verify-release.md'),
    'glossary.md': docsPath('glossary.md'),
    'threat-model.md': docsPath('threat-model.md'),
    'MAINTAINERS.md': join(wsRoot, 'MAINTAINERS.md'),
    'SECURITY.md': join(wsRoot, 'SECURITY.md'),
    'CONTRIBUTING.md': join(wsRoot, 'CONTRIBUTING.md'),
    'CODE_OF_CONDUCT.md': join(wsRoot, 'CODE_OF_CONDUCT.md'),
};
for (const [name, p] of Object.entries(docPaths)) {
    assert.ok(existsSync(p),
        `${name} exists on disk so the parity check item isn't pointing at thin air`);
}

console.log('docs-governance-checklist smoke OK');
