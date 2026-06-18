// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §44 Fee UX, Step 1: FeeSelector primitive.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const cmp = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'FeeSelector.jsx'),
    'utf8',
);
const css = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'FeeSelector.module.css'),
    'utf8',
);
const indexJs = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'index.js'),
    'utf8',
);

// --- public API --------------------------------------------------------

assert.match(cmp, /export function FeeSelector/, 'named export');
assert.match(
    indexJs,
    /export \{ FeeSelector \} from '\.\/FeeSelector\.jsx'/,
    'ui/index re-exports FeeSelector',
);

// --- ARIA radiogroup ---------------------------------------------------

assert.match(cmp, /role="radiogroup"/, 'tier list is a radiogroup');
assert.match(cmp, /role="radio"/, 'tier buttons are radios');
assert.match(cmp, /aria-checked=\{active\}/, 'aria-checked bound to active state');
assert.match(cmp, /aria-labelledby=\{labelId\}/, 'group labelled by label span');
assert.match(cmp, /aria-label=\{`Custom fee rate/, 'custom input labelled');

// --- presets render from `tiers` prop ----------------------------------

assert.match(cmp, /tiers\.low/);
assert.match(cmp, /tiers\.normal/);
assert.match(cmp, /tiers\.fast/);

// --- selection wiring --------------------------------------------------

assert.match(
    cmp,
    /onChange\(\{\s*mode:\s*speed\s*\}\)/,
    'tier click writes mode',
);
assert.match(
    cmp,
    /onChange\(\{\s*mode:\s*'custom'/,
    'custom toggle writes mode + customRate',
);
assert.match(
    cmp,
    /onChange\(\{\s*mode:\s*'custom',\s*customRate:/,
    'custom rate change writes back',
);

// --- empty state -------------------------------------------------------

assert.match(cmp, /Fee estimate unavailable for this chain\./, 'empty-state copy');

// --- placeholder badge -------------------------------------------------

assert.match(
    cmp,
    /placeholderBadge \?/,
    'placeholder badge is conditional',
);
assert.match(
    cmp,
    /Placeholder rates/,
    'placeholder copy present',
);

// --- CSS hooks ---------------------------------------------------------

for (const cls of ['wrap', 'label', 'tiers', 'tier', 'tierActive', 'tierName', 'tierRate', 'tierFee', 'tierEta', 'customRow', 'customInput', 'customUnit', 'placeholder']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `CSS hook .${cls}`);
}

console.log('fee-selector smoke OK');
