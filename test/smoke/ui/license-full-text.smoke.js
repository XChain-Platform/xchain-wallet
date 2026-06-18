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
//   - LICENSE_TEXT matches the canonical LICENSE.md byte-for-byte
//     (modulo trailing whitespace differences caused by the JS
//     template literal's escape semantics).
//   - AboutSection imports LICENSE_TEXT, mounts a "Show full text" /
//     "Hide full text" toggle next to the existing License DocLink,
//     and renders the text in an <pre> with id="full-license-text"
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
// The template literal can't preserve the two-trailing-space line-break
// pattern that markdown uses (those would survive a literal copy, but
// our JS file's editor + linter strips trailing whitespace). Compare
// after normalizing trailing whitespace on each line on BOTH sides so
// the smoke catches actual content drift, not formatting noise.

function normalize(text) {
    return text
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n');
}

assert.equal(
    normalize(LICENSE_TEXT).trim(),
    normalize(licenseMd).trim(),
    'LICENSE_TEXT in license.js is in sync with LICENSE.md (modulo trailing whitespace)',
);

// ─── 3. AboutSection wiring ────────────────────────────────────────────

assert.match(
    aboutSrc,
    /import \{[^}]*LICENSE_TEXT[^}]*\} from '\.\.\/\.\.\/\.\.\/license\.js'/,
    'AboutSection imports LICENSE_TEXT',
);
assert.match(
    aboutSrc,
    /\{LICENSE_SUMMARY\}/,
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
    /id="full-license-text"[\s\S]+?\{LICENSE_TEXT\}/,
    'license <pre> element has the matching id and renders LICENSE_TEXT',
);

console.log('license-full-text smoke OK');
