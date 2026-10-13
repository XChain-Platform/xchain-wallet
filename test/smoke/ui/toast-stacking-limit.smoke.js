// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Toast queue stacking limit.
//
// ToastHost caps the number of simultaneously visible toasts at 3.
// Newer queued toasts wait behind the first three and receive their full
// auto-dismiss interval when they become visible. An overflow badge
// ("+N more") renders above the visible stack when the cap is exceeded.
//
// Asserts:
//   1. ToastHost declares a `VISIBLE_LIMIT = 3` constant.
//   2. The render path slices the first `VISIBLE_LIMIT` entries.
//   3. The overflow indicator renders only when `hiddenCount > 0`.
//   4. The overflow badge has its own CSS class (.overflowBadge).
//   5. The overflow badge is `aria-hidden` (queued toasts still
//      announce themselves as they surface, no double-counting).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const components = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components');

// --- 1. VISIBLE_LIMIT constant -----------------------------------------

const src = readFileSync(join(components, 'ToastHost.jsx'), 'utf8');
assert.ok(/const VISIBLE_LIMIT = 3;/.test(src),
    'ToastHost declares VISIBLE_LIMIT = 3');

// --- 2. Slice to the first N -------------------------------------------

assert.ok(
    /const visibleToasts = toasts\.slice\(0, VISIBLE_LIMIT\);/.test(src),
    'ToastHost renders only the first VISIBLE_LIMIT toasts',
);
assert.ok(
    /\{visibleToasts\.map\(\(t\)\s*=>/.test(src),
    'render path maps over visibleToasts (not the raw toasts array)',
);

// --- 3. hiddenCount + conditional overflow indicator -------------------

assert.ok(
    /const hiddenCount = Math\.max\(0,\s*toasts\.length - visibleToasts\.length\);/.test(src),
    'ToastHost computes hiddenCount from the truncated render set',
);
assert.ok(
    /\{hiddenCount > 0 \?[\s\S]*?\+\$\{hiddenCount\} more/.test(src),
    'overflow indicator renders only when hiddenCount > 0',
);

// --- 4. CSS class --------------------------------------------------------

const css = readFileSync(join(components, 'ToastHost.module.css'), 'utf8');
assert.ok(/\.overflowBadge\b/.test(css),
    '.overflowBadge style is defined in ToastHost.module.css');

// --- 5. aria-hidden + queued toasts still announce ---------------------

assert.ok(
    /<div className=\{styles\.overflowBadge\}\s+aria-hidden="true">/.test(src),
    'overflow badge is aria-hidden; queued toasts continue to announce themselves',
);

console.log(
    'OK: toast-stacking-limit smoke (3 visible at once; queued toasts wait for a visible slot; hiddenCount surfaces an aria-hidden "+N more" badge)',
);
