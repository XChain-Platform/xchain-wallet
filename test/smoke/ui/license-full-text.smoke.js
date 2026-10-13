// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §55 / Cluster J FOLLOWUP 5: full LICENSE.md text surfaced
// in Settings → About.
//
// Pins:
//   - packages/core/src/license.js exports LICENSE_TEXT.
//   - LICENSE_TEXT matches the canonical LICENSE.md wording while storing
//     each paragraph without editorial-width line breaks.
//   - AboutSection imports LICENSE_TEXT, mounts a "Show full text" /
//     "Hide full text" toggle next to the existing License DocLink,
//     and renders the text as paragraphs with id="full-license-text"
//     and aria-expanded / aria-controls wired to the toggle button.

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

assert.match(
    aboutSrc,
    /import \{[^}]*LICENSE_TEXT[^}]*\} from '\.\.\/\.\.\/\.\.\/license\.js'/,
    'AboutSection imports LICENSE_TEXT',
);
assert.match(
    aboutSrc,
    /text=\{LICENSE_SUMMARY\}/,
    'AboutSection renders the plain-English LICENSE_SUMMARY',
);
assert.match(
    aboutSrc,
    /const \[licenseOpen, setLicenseOpen\] = useState\(false\)/,
    'AboutSection tracks licenseOpen state',
);
assert.match(
    aboutSrc,
    /\{licenseOpen \? 'Hide full text' : 'Show full text'\}/,
    'toggle button label flips on licenseOpen',
);
assert.match(
    aboutSrc,
    /aria-expanded=\{licenseOpen\}[\s\S]+?aria-controls="full-license-text"/,
    'toggle button has aria-expanded + aria-controls',
);
assert.match(
    aboutSrc,
    /<LicenseParagraphs[\s\S]+?id="full-license-text"[\s\S]+?text=\{LICENSE_TEXT\}/,
    'license paragraphs have the matching id and render LICENSE_TEXT',
);

console.log('license-full-text smoke OK');
