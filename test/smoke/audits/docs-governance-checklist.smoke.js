// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / Cluster T FOLLOWUPs 4 + 5 — governance section in
// CONTRIBUTING.md + per-section documentation parity check in
// QA-CHECKLIST.md.
//
// Pins:
//   - CONTRIBUTING.md has a Governance section that links to
//     MAINTAINERS.md.
//   - The MAINTAINERS.md file actually exists (the link can't dangle).
//   - QA-CHECKLIST.md has a "Documentation parity check" section
//     covering the major docs (ARCHITECTURE, BRIDGE, REPRODUCIBLE_BUILDS,
//     VERIFY-RELEASE, GLOSSARY, THREAT_MODEL, MAINTAINERS, SECURITY,
//     CONTRIBUTING, CODE_OF_CONDUCT).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const contributing = readFileSync(join(wsRoot, 'CONTRIBUTING.md'), 'utf8');
const qaChecklist = readFileSync(join(wsRoot, 'docs', 'QA-CHECKLIST.md'), 'utf8');

// ─── 1. CONTRIBUTING.md governance ─────────────────────────────────────

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

// ─── 2. QA-CHECKLIST.md per-section docs check ─────────────────────────

assert.match(qaChecklist, /^## Documentation parity check$/m,
    'QA-CHECKLIST has a Documentation parity check section');

// Each canonical doc should appear in the parity check.
const docsToCover = [
    'ARCHITECTURE.md',
    'BRIDGE.md',
    'REPRODUCIBLE_BUILDS.md',
    'VERIFY-RELEASE.md',
    'GLOSSARY.md',
    'THREAT_MODEL.md',
    'MAINTAINERS.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
];
for (const doc of docsToCover) {
    assert.match(
        qaChecklist,
        new RegExp(doc.replace(/\./g, '\\.')),
        `parity check mentions ${doc}`,
    );
}

// And each doc should actually exist on disk so the checklist isn't
// asking the user to verify a phantom file.
const docPaths = {
    'ARCHITECTURE.md': join(wsRoot, 'docs', 'ARCHITECTURE.md'),
    'BRIDGE.md': join(wsRoot, 'docs', 'BRIDGE.md'),
    'REPRODUCIBLE_BUILDS.md': join(wsRoot, 'docs', 'REPRODUCIBLE_BUILDS.md'),
    'VERIFY-RELEASE.md': join(wsRoot, 'docs', 'VERIFY-RELEASE.md'),
    'GLOSSARY.md': join(wsRoot, 'docs', 'GLOSSARY.md'),
    'THREAT_MODEL.md': join(wsRoot, 'docs', 'THREAT_MODEL.md'),
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
