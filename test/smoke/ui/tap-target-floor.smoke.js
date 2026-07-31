// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  responsive-first program, slice 2: the pointer-target floor.
//
// The wallet is one interface at every width, so it gets ONE answer to
// "how small may a control be": WCAG 2.2 AA 2.5.8, 24x24 CSS px, held in
// the `--xc-tap-min` token. Nine controls were under it before this slice
// (16px help dot, 13px fee-slider stops, 14px unit swap, 18px watchlist
// star, 20px settings switch, 19px palette search, ...), and every one of
// them was invisible to the test suite: jsdom lays nothing out, so a
// measured box is a question only a browser can answer.
//
// tests/e2e/tests/responsive/viewports.spec.js IS that browser and is the
// real proof. This smoke is the cheap half: it keeps the token in place
// and keeps each fixed control pointing AT the token, so the next edit to
// one of these files cannot quietly reintroduce a hard-coded 16px without
// someone reading a red line that says why the number matters.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const core = join(root, 'packages', 'core', 'src');

const read = (...parts) => readFileSync(join(core, ...parts), 'utf8');

// --- 1. the token exists and says 24px ---------------------------------

const tokens = read('ui', 'tokens.css');
assert.ok(/--xc-tap-min:\s*24px;/.test(tokens),
    'tokens.css defines --xc-tap-min: 24px (WCAG 2.2 AA 2.5.8)');
assert.ok(/WCAG 2\.2 AA 2\.5\.8/.test(tokens),
    'the token names the standard it implements, so the number is not folklore');

// --- 2. the controls that were under it reference it -------------------

// Each entry is a control the live width walk caught below the floor.
// Asserting on the token (not on a pixel number) is deliberate: a future
// change to the floor should move one line in tokens.css and take every
// one of these with it.
const CONSUMERS = [
    ['ui/InfoTip.module.css', 'the contextual help dot (was 16x16)'],
    ['ui/FeeSelector.module.css', 'the fee slider, its tier stops and the editable readouts (were 16/13/17px)'],
    ['shared/components/PortfolioChart.module.css', 'the chart range chips (were 20px tall)'],
    ['shared/components/AmountField.module.css', 'the coin/fiat unit swap (was 14px tall)'],
    ['shared/routes/Send.module.css', 'the Advanced disclosure (was 21px tall)'],
    ['shared/commandPalette/CommandPalette.module.css', 'the palette search field (was 19px tall)'],
    ['shared/routes/MarketsList.jsx', 'the watchlist star (was 18x18)'],
    ['shared/components/settings/_settingsPrimitives.jsx', 'every settings switch (was 20px tall)'],
];

for (const [rel, what] of CONSUMERS) {
    const src = readFileSync(join(core, ...rel.split('/')), 'utf8');
    assert.ok(/--xc-tap-min/.test(src),
        `${rel} sizes ${what} from --xc-tap-min`);
}

// --- 3. the InfoTip dot is painted by the glyph, not the button --------

// The one fix here that is structural rather than a size bump: the button
// grew to the target floor and handed its circle to an inner span, so the
// affordance still looks like a 16px dot. If the glyph goes away, the
// button either shrinks back under the floor or paints a 24px blob.
const infoTipJsx = read('ui', 'InfoTip.jsx');
assert.ok(/className=\{styles\.glyph\}/.test(infoTipJsx),
    'InfoTip renders its painted dot as an inner .glyph span');
const infoTipCss = read('ui', 'InfoTip.module.css');
assert.ok(/\.glyph\s*\{[\s\S]*?width:\s*16px/.test(infoTipCss),
    '.glyph keeps the dot at its designed 16px');
assert.ok(/\.trigger:focus-visible \.glyph\s*\{[\s\S]*?outline:/.test(infoTipCss),
    'the focus ring is drawn around the dot, not around the padded target box');

console.log(
    'OK: tap-target-floor smoke ( slice 2: --xc-tap-min = 24px per WCAG 2.2 AA 2.5.8; '
    + `${CONSUMERS.length} previously-undersized controls size from the token; `
    + 'InfoTip paints a 16px .glyph inside a 24px target and rings the glyph on focus)',
);
