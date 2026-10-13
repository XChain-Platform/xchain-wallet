// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// InfoTip placement stays within the visible viewport on narrow,
// zoomed, and panned screens.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const tipSrc = read('packages/core/src/ui/InfoTip.jsx');
const cssSrc = read('packages/core/src/ui/InfoTip.module.css');

// 1. Component imports the layout-effect hook (so the alignment is
//    measured before the browser paints).
assert.ok(/useLayoutEffect/.test(tipSrc),
    'InfoTip imports useLayoutEffect for measurement timing');

// 2. Layout state carries an exact horizontal correction and a width cap.
assert.ok(/\[maxWidth, setMaxWidth\] = useState/.test(tipSrc),
    'InfoTip tracks the visible viewport width cap');
assert.ok(/\[horizontalOffset, setHorizontalOffset\] = useState\(0\)/.test(tipSrc),
    'InfoTip tracks an exact horizontal correction');

// 3. The component measures both the trigger and rendered bubble against
//    the viewport so wrapped content uses its actual dimensions.
assert.ok(/bubbleRef/.test(tipSrc),
    'InfoTip keeps a ref to the rendered bubble');
assert.ok(/bubble\.getBoundingClientRect/.test(tipSrc),
    'InfoTip measures the rendered bubble');
assert.ok(/document\.documentElement\?\.clientWidth/.test(tipSrc),
    'InfoTip reads viewport width from document.documentElement.clientWidth');
assert.ok(/document\.documentElement\?\.clientHeight/.test(tipSrc),
    'InfoTip reads viewport height from document.documentElement.clientHeight');
assert.ok(/window\.visualViewport/.test(tipSrc),
    'InfoTip uses the visual viewport when mobile zoom or panning changes the visible area');

// 4. The measured width is capped and its left edge is clamped between both
//    visible viewport margins.
assert.ok(/Math\.min\(bubbleRect\.width \|\| widthLimit, widthLimit\)/.test(tipSrc),
    'InfoTip caps its measured width to the visible viewport');
assert.ok(/Math\.min\(Math\.max\(centeredLeft, minimumLeft\), maximumLeft\)/.test(tipSrc),
    'InfoTip clamps the bubble between the left and right viewport margins');
assert.ok(/bubbleHeight > preferredSpace && oppositeSpace > preferredSpace/.test(tipSrc),
    'InfoTip flips sides when the preferred side lacks vertical room');
assert.ok(/setMaxHeight/.test(tipSrc),
    'InfoTip caps long content to the available vertical room');

// 5. Resize listener so a viewport rotation / window-resize doesn't
//    leave the bubble mis-aligned while it's still open.
assert.ok(/window\.addEventListener\('resize', onResize\)/.test(tipSrc),
    'InfoTip subscribes to resize while open');
assert.ok(/window\.removeEventListener\('resize', onResize\)/.test(tipSrc),
    'InfoTip cleans up its resize listener');
assert.ok(/visualViewport\?\.addEventListener\('scroll', onResize\)/.test(tipSrc),
    'InfoTip recomputes when the visible mobile viewport pans');

// 6. CSS uses the same physical coordinate system as the measured correction,
//    so RTL direction does not reverse the anchor edge.
assert.ok(/\.bubble\s*\{[^}]*left:\s*50%/.test(cssSrc),
    'CSS physically anchors the bubble at the trigger center');
assert.ok(!/\.bubble\s*\{[^}]*inset-inline-start:/.test(cssSrc),
    'CSS does not reverse the measured anchor in RTL layouts');

// 7. The bubble applies its exact horizontal correction inline.
assert.ok(/transform:\s*`translateX\(-50%\) translateX\(\$\{horizontalOffset\}px\)`/.test(tipSrc),
    'InfoTip applies the measured horizontal correction');

assert.ok(/max-width:\s*min\(260px, calc\(100vw - 2 \* var\(--xc-space-2\)\)\)/.test(cssSrc),
    'InfoTip bubble width stays within narrow viewports');
assert.ok(/overflow-wrap:\s*anywhere/.test(cssSrc),
    'InfoTip wraps unbroken content');

console.log('OK: InfoTip placement-aware overflow re-anchor');
