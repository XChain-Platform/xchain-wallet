// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the ChainPicker size rework: it now takes the shared `size` prop
// and its trigger matches the Input chrome/height (one line, 36px md / 48px
// lg) instead of the old oversized two-line trigger.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const cmp = read('packages', 'core', 'src', 'ui', 'ChainPicker.jsx');
const css = read('packages', 'core', 'src', 'ui', 'ChainPicker.module.css');

// --- size prop, wired like the other fields -----------------------------

assert.match(cmp, /size = 'md'/, 'ChainPicker defaults size to md');
assert.match(cmp, /\$\{styles\[size\]/, 'ChainPicker applies the size class to the wrap');

// --- trigger matches the Input size contract ----------------------------

assert.match(css, /\.trigger\s*\{[^}]*min-height:\s*36px/s, 'md trigger is 36px like Input');
assert.match(css, /\.trigger\s*\{[^}]*border-radius:\s*var\(--xc-radius-md\)/s, 'trigger uses the shared field radius');
assert.match(css, /\.trigger\s*\{[^}]*padding:\s*var\(--xc-space-2\) var\(--xc-space-3\)/s, 'trigger uses the shared field padding');
assert.match(css, /\.lg \.trigger\s*\{[^}]*min-height:\s*48px/s, 'lg trigger is 48px');

// --- single-line trigger (the two-line stack is gone) -------------------

assert.doesNotMatch(css, /\.triggerSub\b/, 'old two-line triggerSub removed');
assert.match(cmp, /styles\.triggerKind/, 'network-kind rendered inline as a suffix');
assert.doesNotMatch(cmp, /styles\.triggerSub/, 'no two-line sub in the trigger');

console.log('chain-picker-size smoke OK');
