// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / Cluster T FOLLOWUP 2 — VERIFY-RELEASE.md surfaced
// from Settings → About.
//
// Pins:
//   - buildInfo.js exports VERIFY_RELEASE_DOC pointing at docs/VERIFY-RELEASE.md.
//   - The doc file actually exists.
//   - AboutSection.jsx imports VERIFY_RELEASE_DOC and renders a "Verify a
//     release" row pointing at it via the existing DocLink primitive.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const buildInfoSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'buildInfo.js'),
    'utf8',
);
const aboutSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'AboutSection.jsx'),
    'utf8',
);

assert.match(
    buildInfoSrc,
    /export const VERIFY_RELEASE_DOC = 'docs\/VERIFY-RELEASE\.md'/,
    'buildInfo exports VERIFY_RELEASE_DOC',
);

const docPath = join(wsRoot, 'docs', 'VERIFY-RELEASE.md');
assert.ok(existsSync(docPath),
    'docs/VERIFY-RELEASE.md actually exists at the path the constant claims');

assert.match(
    aboutSrc,
    /VERIFY_RELEASE_DOC/,
    'AboutSection imports VERIFY_RELEASE_DOC',
);
assert.match(
    aboutSrc,
    /<Row label="Verify a release">[\s\S]+?<DocLink path=\{VERIFY_RELEASE_DOC\} label="Verification recipe"/,
    'AboutSection renders a "Verify a release" row pointing at the doc',
);

console.log('about-verify-release smoke OK');
