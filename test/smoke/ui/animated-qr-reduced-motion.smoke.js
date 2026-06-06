// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch — user-initiated track Step 3 — reduced-motion
// preference on AnimatedQrFrames. Static-text checks over the component
// source, asserting the reduced-motion subscription, the auto-advance
// suspension, and the manual prev/next affordance are all wired in.
//
// The runtime behaviour (matchMedia firing change events, setInterval
// not running while reduced) is exercised indirectly by `pnpm test`'s
// jsdom suite when @testing-library lands AnimatedQrFrames coverage;
// this smoke is the cheap gate that catches reverts in plain Node.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = join(here, '..', '..', '..', 'packages', 'core', 'src', 'ui', 'AnimatedQrFrames.jsx');
const src = readFileSync(componentPath, 'utf8');

// 1. The component subscribes to the prefers-reduced-motion media query.
assert.ok(
    /matchMedia\(\s*['"]\(prefers-reduced-motion: reduce\)['"]/.test(src),
    'AnimatedQrFrames calls window.matchMedia with the prefers-reduced-motion query',
);

// 2. State for the preference is held by useState so the component
//    re-renders when the OS-level setting flips.
assert.ok(
    /const \[reducedMotion,\s*setReducedMotion\]\s*=\s*useState\(/.test(src),
    'AnimatedQrFrames declares a reducedMotion state hook',
);

// 3. The change-event handler updates the preference. Either the modern
//    addEventListener path or the legacy addListener path must be present;
//    we assert the modern one (with a fallback for legacy Safari noted in
//    the source).
assert.ok(
    /mq\.addEventListener\(\s*['"]change['"]/.test(src),
    'AnimatedQrFrames listens for change events on the media query',
);
assert.ok(
    /mq\.addListener\(/.test(src),
    'AnimatedQrFrames keeps a Safari-<14 fallback to mq.addListener',
);

// 4. The auto-advance interval bails out when reducedMotion is true.
assert.ok(
    /if\s*\(\s*reducedMotion\s*\)\s*return undefined;/.test(src),
    'AnimatedQrFrames suspends setInterval when reducedMotion is true',
);

// 5. Prev / Next buttons render only in reduced-motion + multi-frame mode.
assert.ok(
    /reducedMotion && multiFrame/.test(src),
    'AnimatedQrFrames gates manual controls on reducedMotion && multiFrame',
);
assert.ok(
    /aria-label="Previous frame"/.test(src),
    'AnimatedQrFrames Prev button has an aria-label',
);
assert.ok(
    /aria-label="Next frame"/.test(src),
    'AnimatedQrFrames Next button has an aria-label',
);

// 6. The cadence label changes from "<fps> fps" to "manual" when reduced.
assert.ok(
    /reducedMotion[\s\S]*?'manual'[\s\S]*?:\s*`\$\{fps\} fps`/.test(src),
    'AnimatedQrFrames cadence label flips to "manual" under reduced motion',
);

// 7. The aria-label on the wrapper announces the manual-advance affordance.
assert.ok(
    /advance manually/.test(src),
    'AnimatedQrFrames wrapper aria-label communicates the manual-advance state',
);

// 8. data-reduced-motion attribute is rendered for downstream tests/styling.
assert.ok(
    /data-reduced-motion=\{reducedMotion \? 'true' : 'false'\}/.test(src),
    'AnimatedQrFrames exposes a data-reduced-motion attribute on the wrapper',
);

console.log(
    'OK — AnimatedQrFrames reduced-motion smoke (matchMedia subscription + change listener with Safari fallback + interval suspension + prev/next manual controls + aria-labels + cadence label flip + wrapper aria announcement + data-reduced-motion attribute)',
);
