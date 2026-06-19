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

// --- slider control ----------------------------------------------------
// The fee picker is a range slider with discrete Low / Normal / Fast /
// Custom stops (chosen over a radiogroup; it is a11y-valid via a labelled
// range input + aria-valuetext that announces the active tier).

assert.match(cmp, /type="range"/, 'fee control is a range slider');
assert.match(cmp, /aria-label="Network fee"/, 'slider is labelled "Network fee"');
assert.match(cmp, /aria-valuetext=/, 'slider announces the active tier via aria-valuetext');
assert.match(cmp, /aria-label=\{SPEED_LABELS\[s\]\}/, 'each discrete tick is labelled by speed');
assert.match(cmp, /aria-label=\{`Custom fee rate/, 'custom rate input labelled');

// --- presets render from `tiers` prop ----------------------------------

assert.match(cmp, /TIER_SPEEDS = \['low', 'normal', 'fast'\]/, 'three preset tiers');
assert.match(cmp, /tiers\[speed\]/, 'tier estimates read from the tiers prop');

// --- selection wiring --------------------------------------------------

assert.match(
    cmp,
    /onChange\(\{ mode: speed \}\)/,
    'tier pick writes mode',
);
assert.match(
    cmp,
    /onChange\(\{ mode: 'custom', customRate: seedCustomRate\(\) \}\)/,
    'landing on Custom seeds a starting rate',
);
assert.match(
    cmp,
    /onChange\(\{ mode: 'custom', customRate: Number\.isFinite\(n\) \? n : 0 \}\)/,
    'custom rate change writes back',
);

// --- empty state -------------------------------------------------------

assert.match(cmp, /Fee estimate unavailable for this chain\./, 'empty-state copy');

// --- contextual help (§37 / G122 InfoTip) ------------------------------

assert.match(cmp, /aria="Network fee help"/, 'fee selector carries the Network-fee InfoTip');

// --- CSS hooks ---------------------------------------------------------

for (const cls of ['wrap', 'label', 'sliderBlock', 'slider', 'sliderTicks', 'sliderTick', 'sliderTickActive', 'sliderReadout', 'customRow', 'customInput', 'customUnit', 'placeholder']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `CSS hook .${cls}`);
}

console.log('fee-selector smoke OK');
