// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §13 / Cluster T FOLLOWUP 2: the release-verification recipe
// surfaced from Settings → About.
//
//  moved the wallet's prose docs to the xchain-documentation repo
// and published them at docs.xchain.io, so the constant is now a URL the
// About panel can actually open rather than a repo-relative path.
//
// Pins:
//   - buildInfo.js exports VERIFY_RELEASE_DOC as the hosted verify-release URL.
//   - AboutSection.jsx imports VERIFY_RELEASE_DOC and renders a "Verify a
//     release" row pointing at it via the existing DocLink primitive.
//   - DocLink renders an absolute URL as a real anchor.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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

const verifyDoc = /export const VERIFY_RELEASE_DOC = '([^']+)';/.exec(buildInfoSrc);
assert.ok(verifyDoc, 'buildInfo exports VERIFY_RELEASE_DOC');
assert.equal(
    verifyDoc[1],
    'https://docs.xchain.io/components/wallet/release/verify-release',
    'VERIFY_RELEASE_DOC is the hosted verify-release page, not a repo path',
);
// A user who taps this must land somewhere. Anything the browser cannot
// open (a bare path, a relative link) is the failure this pins against.
assert.doesNotThrow(() => new URL(verifyDoc[1]),
    'VERIFY_RELEASE_DOC parses as an absolute URL');

assert.match(
    aboutSrc,
    /rel="noreferrer noopener"/,
    'DocLink opens hosted docs in a new context without leaking the opener',
);

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
