// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// smoke: the safe-area inset and the app shell's height are ONE
// decision, and this asserts they are still made together.
//
// What went wrong, measured on an iPhone 17 Pro simulator rather than
// reasoned about: `body` pads itself by `env(safe-area-inset-top)` (62pt
// there), which moves the shell's top edge below the status bar - correct.
// But the shell was `100dvh` tall, a FULL viewport, so starting 62pt down
// it ended 62pt below the screen. The document became scrollable by exactly
// the inset, the bottom tab bar sat off-screen until you scrolled, and
// scrolling to reach it slid the header up under the clock. Every screenshot
// the App Store listing harness took showed the app chrome overlapping the
// status bar, and every individual rule involved was correct.
//
// Asserts:
//   1. `body` still carries the top inset as padding (if that ever goes
//      away, the subtraction below becomes wrong and must go with it).
//   2. tokens.css defines --xc-viewport-h as the viewport MINUS that inset.
//   3. Both root height consumers (Screen, FullLayoutWithNav's layout) fall
//      back to --xc-viewport-h and NOT to a bare 100vh/100dvh.
//   4. The Android shell replaces that token with the native WebView's
//      innerHeight, because WebView 102 can resolve 100vh below its visible
//      and accessibility bounds after Capacitor applies system-bar padding.
//
// Rule 3 is the one that rots: a bare `100dvh` reads as obviously right,
// and on every non-iOS shell it behaves identically, so nothing but a
// device catches it.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, '..', '..', '..', 'packages', 'core');

const tokens = readFileSync(join(core, 'src', 'ui', 'tokens.css'), 'utf8');
const screen = readFileSync(join(core, 'src', 'ui', 'Screen.module.css'), 'utf8');
const leftNav = readFileSync(
    join(core, 'src', 'shared', 'components', 'LeftNav.module.css'),
    'utf8',
);
const keyboardViewport = readFileSync(
    join(core, '..', 'web', 'src', 'platform', 'keyboardViewport.js'),
    'utf8',
);

// --- 1. body still pays the top inset -----------------------------------

assert.match(
    tokens,
    /padding-top:\s*env\(safe-area-inset-top/,
    'tokens.css body still pads by the top safe-area inset',
);

// --- 2. the token subtracts exactly that ---------------------------------

const viewportH = tokens.match(/--xc-viewport-h:[^;]+;/g) || [];
assert.ok(
    viewportH.length >= 1,
    'tokens.css defines --xc-viewport-h',
);
for (const decl of viewportH) {
    assert.match(
        decl,
        /calc\(\s*100d?vh\s*-\s*env\(safe-area-inset-top/,
        `--xc-viewport-h subtracts the top inset from the viewport: ${decl}`,
    );
}
// A unitless fallback would make the calc() invalid the moment env() is
// undefined, which silently drops the whole height declaration.
for (const decl of viewportH) {
    assert.match(
        decl,
        /env\(safe-area-inset-top,\s*0px\s*\)/,
        `--xc-viewport-h's env() fallback carries a unit: ${decl}`,
    );
}

// --- 2b. the dvh form is gated, never a second declaration in :root -------
//
// A custom property accepts any tokens, so a later `--xc-viewport-h` always
// wins the cascade. Written as a plain pair inside :root, the dvh form won on
// engines WITHOUT dvh too (Chromium below 108), was invalid where it was used,
// and took the shell's height with it: the bottom tab bar floated mid-screen
// on an LG K51's stock WebView 102 (2026-10-12).

const rootBlock = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('\n}\n', tokens.indexOf(':root {')));
assert.ok(rootBlock.length > 100, 'located the leading :root block in tokens.css');
const rootDecls = rootBlock.match(/--xc-viewport-h:[^;]+;/g) || [];
assert.equal(rootDecls.length, 1, ':root declares --xc-viewport-h exactly once');
assert.match(rootDecls[0], /100vh/, 'the unconditional --xc-viewport-h uses plain vh');
assert.doesNotMatch(rootDecls[0], /dvh/, 'the unconditional --xc-viewport-h does not need dvh');
assert.match(
    tokens,
    /@supports \(height: 100dvh\) \{\s*:root \{\s*--xc-viewport-h: calc\(100dvh - env\(safe-area-inset-top, 0px\)\);/,
    'the dvh form of --xc-viewport-h sits behind @supports (height: 100dvh)',
);

// --- 3. both root consumers use it ---------------------------------------

for (const [name, css] of [['Screen.module.css', screen], ['LeftNav.module.css', leftNav]]) {
    const heights = (css.match(/height:\s*var\(--xc-screen-h[^;]*;/g) || []);
    assert.ok(
        heights.length >= 1,
        `${name} sizes its root off --xc-screen-h`,
    );
    for (const decl of heights) {
        assert.match(
            decl,
            /var\(--xc-screen-h,\s*var\(--xc-viewport-h/,
            `${name} falls back to --xc-viewport-h, not a bare viewport unit: ${decl}`,
        );
    }
}

// --- 4. Android uses the native WebView's visible height -----------------

assert.match(
    keyboardViewport,
    /Capacitor\?\.getPlatform\?\.\(\) === 'android'/,
    'the viewport override is limited to the Android native shell',
);
assert.match(
    keyboardViewport,
    /--xc-viewport-h'[\s\S]*?Math\.round\(win\.innerHeight\)/,
    'Android sizes --xc-viewport-h from the native WebView innerHeight',
);

console.log('safe-area-shell-height smoke OK');
