// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / G015 — root `docs/REPRODUCIBLE_BUILDS.md`.
//
// The desktop shell already ships a deep `packages/desktop/REPRODUCIBLE_BUILDS.md`
// (covered by the desktop-packaging smoke). This smoke pins the new
// project-wide doc that orients across every shell, plus the
// `buildInfo.REPRODUCIBLE_BUILD_DOC` constant flip from the per-target
// path to the new root path.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Doc exists + the desktop deeper-doc still exists alongside it.
const rootDoc = 'docs/REPRODUCIBLE_BUILDS.md';
const desktopDoc = 'packages/desktop/REPRODUCIBLE_BUILDS.md';
assert.ok(existsSync(join(root, rootDoc)), `${rootDoc} exists`);
assert.ok(existsSync(join(root, desktopDoc)), `${desktopDoc} still exists`);

const docSrc = read(rootDoc);

// 2. Required headings.
const requiredHeadings = [
    '# Reproducible builds',
    '## What "reproducible" means here',
    '## Per-target status',
    '## Verification protocol',
    '## Non-determinism sources we have addressed',
    '## Trust boundaries',
];
for (const heading of requiredHeadings) {
    assert.ok(docSrc.includes(heading), `root repro doc has heading: ${heading}`);
}

// 3. Per-target table covers every shell.
for (const target of ['Desktop', 'Extension', 'Web']) {
    assert.ok(new RegExp(`\\| ${target} \\|`).test(docSrc),
        `per-target table includes a row for ${target}`);
}

// 4. Cross-links to deeper / related docs resolve.
const crossLinks = [
    'packages/desktop/REPRODUCIBLE_BUILDS.md',
    'docs/VERIFY-RELEASE.md',
    'SECURITY.md',
];
for (const linkPath of crossLinks) {
    assert.ok(docSrc.includes(linkPath),
        `root repro doc references ${linkPath}`);
}
// All cross-link targets exist OR are explicitly tracked as gaps.
// Desktop doc and SECURITY.md must exist; VERIFY-RELEASE.md is the
// next step in this cluster and lands in v0.222.0.
assert.ok(existsSync(join(root, 'packages/desktop/REPRODUCIBLE_BUILDS.md')),
    'desktop repro doc target exists');
assert.ok(existsSync(join(root, 'SECURITY.md')),
    'SECURITY.md target exists');

// 5. Spec reference present so readers know which §51 row this closes.
assert.ok(/§51/.test(docSrc) && /XCHAIN_WALLET_SPEC\.md/.test(docSrc),
    'root repro doc cites §51 of XCHAIN_WALLET_SPEC.md');
assert.ok(/Level[- ]?2/i.test(docSrc),
    'doc states Level-2 reproducibility goal');

// 6. buildInfo.REPRODUCIBLE_BUILD_DOC points at the new root doc, and
//    a sibling REPRODUCIBLE_BUILD_DOC_DESKTOP keeps a pointer to the
//    deeper desktop-specific recipe so consumers can still reach it.
const buildInfoSrc = read('packages/core/src/buildInfo.js');
assert.ok(/export const REPRODUCIBLE_BUILD_DOC = 'docs\/REPRODUCIBLE_BUILDS\.md'/.test(buildInfoSrc),
    'buildInfo.REPRODUCIBLE_BUILD_DOC points at the new root doc');
assert.ok(/export const REPRODUCIBLE_BUILD_DOC_DESKTOP = 'packages\/desktop\/REPRODUCIBLE_BUILDS\.md'/.test(buildInfoSrc),
    'buildInfo exposes REPRODUCIBLE_BUILD_DOC_DESKTOP for the deeper recipe');

console.log('OK — root REPRODUCIBLE_BUILDS.md doc + buildInfo flip smoke');
