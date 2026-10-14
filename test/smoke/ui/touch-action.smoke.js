// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const tracked = (pattern) => execFileSync(
    'git',
    ['ls-files', pattern],
    { cwd: root, encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

const tokens = readFileSync(join(root, 'packages/core/src/ui/tokens.css'), 'utf8');

assert.match(
    tokens,
    /:where\([\s\S]*?button,[\s\S]*?\[role='button'\],[\s\S]*?\[role='option'\],[\s\S]*?label\s*\)\s*\{\s*touch-action:\s*manipulation;\s*\}/,
    'native controls and semantic tappable rows use touch-action: manipulation',
);
assert.match(
    tokens,
    /:where\(\[role='dialog'\], \[role='dialog'\] \*\)\s*\{\s*overscroll-behavior:\s*contain;\s*\}/,
    'dialog scrollports contain overscroll instead of chaining into the page',
);

let touchDeclarations = 0;
for (const rel of tracked('*.css')) {
    const css = readFileSync(join(root, rel), 'utf8');
    for (const match of css.matchAll(/touch-action:\s*([^;]+);/g)) {
        touchDeclarations += 1;
        const value = match[1].trim();
        assert.ok(
            value === 'auto'
                || value === 'manipulation'
                || /(^|\s)pinch-zoom($|\s)/.test(value),
            `${rel} keeps pinch zoom available in "touch-action: ${value}"`,
        );
    }
}
assert.ok(touchDeclarations > 0, 'the CSS tree contains audited touch-action declarations');

for (const rel of tracked('*.html')) {
    const html = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(html, /user-scalable\s*=\s*no/i, `${rel} permits user scaling`);
    assert.doesNotMatch(html, /maximum-scale\s*=/i, `${rel} does not cap pinch zoom`);
}

console.log(
    `OK: touch-action smoke (${touchDeclarations} safe touch-action declarations; `
    + 'modal overscroll contained; viewport metadata permits pinch zoom)',
);
