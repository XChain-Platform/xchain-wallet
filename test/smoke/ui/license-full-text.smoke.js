// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the bundled license copy and the external About license row.
//
// Pins:
//   - packages/core/src/license.js exports LICENSE_TEXT.
//   - LICENSE_TEXT matches the canonical LICENSE.md wording while storing
//     each paragraph without editorial-width line breaks.
//   - About links to LICENSE.md externally and renders no document content.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSE_TEXT, LICENSE_SUMMARY } from '../../../packages/core/src/license.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const licenseMd = readFileSync(join(wsRoot, 'LICENSE.md'), 'utf8');
const aboutSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'AboutSection.jsx'),
    'utf8',
);
const licenseSrc = readFileSync(join(wsRoot, 'packages', 'core', 'src', 'license.js'), 'utf8');
const settingsSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
    'utf8',
);

// ─── 1. license.js export ──────────────────────────────────────────────

assert.equal(typeof LICENSE_TEXT, 'string', 'LICENSE_TEXT is a string');
assert.ok(LICENSE_TEXT.length > 100, 'LICENSE_TEXT is non-trivial');
assert.match(LICENSE_TEXT, /GNU AFFERO GENERAL PUBLIC LICENSE/, 'LICENSE_TEXT carries the headline');
assert.match(LICENSE_TEXT, /www\.gnu\.org\/licenses/, 'LICENSE_TEXT carries the closing reference');

// Plain-English summary shown by default in the About panel (relicense to AGPL).
assert.equal(typeof LICENSE_SUMMARY, 'string', 'LICENSE_SUMMARY is a string');
assert.match(LICENSE_SUMMARY, /AGPL-3\.0/, 'LICENSE_SUMMARY names the license in plain language');

// ─── 2. sync invariant: LICENSE_TEXT === LICENSE.md ────────────────────
//
// The bundled copy deliberately removes editorial-width line breaks. Compare
// after normalizing whitespace so the smoke catches wording drift without
// requiring the UI copy to inherit the source document's line length.

function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
}

assert.equal(
    normalize(LICENSE_TEXT),
    normalize(licenseMd),
    'LICENSE_TEXT in license.js has the same wording as LICENSE.md',
);

// ─── 3. AboutSection wiring ────────────────────────────────────────────

assert.doesNotMatch(aboutSrc, /from '\.\.\/\.\.\/\.\.\/license\.js'/, 'About imports no bundled license copy');
assert.doesNotMatch(aboutSrc, /licenseOpen|aria-expanded/, 'About has no expand-in-place license toggle');
assert.match(
    aboutSrc,
    /title=\{t\('settings\.about\.license'\)\}[\s\S]+?docLinkProps\(LICENSE_FILE\)/,
    'About links the License row to the repository file',
);
assert.doesNotMatch(aboutSrc, /AboutLicensePage|full-license-text/, 'About has no in-app license page');
assert.doesNotMatch(settingsSrc, /about-license|LicenseHeaderButton/, 'Settings has no license child route');

// ─── 4. removed in-app helpers stay removed ────────────────────────────

assert.doesNotMatch(licenseSrc, /export const LICENSE_(?:NOTICE|TERMS)/, 'in-app license helpers are removed');

console.log('license-full-text smoke OK');
