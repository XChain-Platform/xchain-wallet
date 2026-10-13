// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster P FOLLOWUP 3: InfoTip placement-aware overflow. v0.210.0
// shipped a center-anchored bubble (`inset-inline-start: 50%;
// transform: translateX(-50%)`); in narrow contexts (extension popup
// is 360px wide) a tooltip near the right edge of the screen could
// clip. This sweep adds a measurement-driven re-anchor; when the
// trigger sits in a position where the center-anchored bubble would
// overflow either viewport edge, the alignment class swaps to the
// near-edge anchor.

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

// 2. Alignment state initialises to 'center' (preserves v0.210.0
//    layout for triggers that fit comfortably) and tracks 'start' /
//    'end' for the re-anchored cases.
assert.ok(/setAlign\] = useState\(\/\*\* @type \{'start' \| 'center' \| 'end'\} \*\/ \('center'\)\)/.test(tipSrc),
    'InfoTip declares an align state with three values defaulting to center');

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

// 4. Re-anchor branches use half of the rendered width and retain a viewport
//    margin on either side.
assert.ok(/bubbleRect\.width \|\| Math\.min\(260, viewportWidth - 2 \* VIEWPORT_MARGIN\)/.test(tipSrc),
    'InfoTip uses the measured width with a viewport-bounded fallback');
assert.ok(/center - halfWidth < VIEWPORT_MARGIN/.test(tipSrc),
    'InfoTip swaps to start when the bubble would clip the left edge');
assert.ok(/center \+ halfWidth > viewportWidth - VIEWPORT_MARGIN/.test(tipSrc),
    'InfoTip swaps to end when the bubble would clip the right edge');
assert.ok(/bubbleRect\.height > preferredSpace && oppositeSpace > preferredSpace/.test(tipSrc),
    'InfoTip flips sides when the preferred side lacks vertical room');
assert.ok(/setMaxHeight/.test(tipSrc),
    'InfoTip caps long content to the available vertical room');

// 5. Resize listener so a viewport rotation / window-resize doesn't
//    leave the bubble mis-aligned while it's still open.
assert.ok(/window\.addEventListener\('resize', onResize\)/.test(tipSrc),
    'InfoTip subscribes to resize while open');
assert.ok(/window\.removeEventListener\('resize', onResize\)/.test(tipSrc),
    'InfoTip cleans up its resize listener');

// 6. CSS exports three alignment classes with the expected anchor
//    rules. .alignCenter mirrors the prior layout; .alignStart anchors
//    the bubble's start edge; .alignEnd anchors the bubble's end edge.
assert.ok(/\.alignCenter\s*\{[^}]*inset-inline-start:\s*50%;[^}]*transform:\s*translateX\(-50%\)/.test(cssSrc),
    'CSS .alignCenter matches the v0.210.0 center anchor');
assert.ok(/\.alignStart\s*\{[^}]*inset-inline-start:\s*0;[^}]*transform:\s*none/.test(cssSrc),
    'CSS .alignStart anchors the bubble to the trigger\'s start edge');
assert.ok(/\.alignEnd\s*\{[^}]*inset-inline-end:\s*0;[^}]*inset-inline-start:\s*auto;[^}]*transform:\s*none/.test(cssSrc),
    'CSS .alignEnd anchors the bubble to the trigger\'s end edge');

// 7. The bubble JSX appends the alignment class alongside the
//    existing top/bottom placement class.
assert.ok(/className=\{`\$\{styles\.bubble\} \$\{side === 'bottom' \? styles\.placementBottom : styles\.placementTop\} \$\{alignClass\}`\}/.test(tipSrc),
    'InfoTip composes bubble + placement + alignment classes on the bubble element');

assert.ok(/max-width:\s*min\(260px, calc\(100vw - 2 \* var\(--xc-space-2\)\)\)/.test(cssSrc),
    'InfoTip bubble width stays within narrow viewports');
assert.ok(/overflow-wrap:\s*anywhere/.test(cssSrc),
    'InfoTip wraps unbroken content');

console.log('OK: InfoTip placement-aware overflow re-anchor');
