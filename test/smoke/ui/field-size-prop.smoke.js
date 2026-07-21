// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the shared field-size contract: Input/Select/Textarea take a
// `size` prop ('md' default / 'lg' 48px), the big-field values live once in
// Input.module.css `.lg`, and the composed fields + Send forward the prop.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const inputJs = read('packages', 'core', 'src', 'ui', 'Input.jsx');
const inputCss = read('packages', 'core', 'src', 'ui', 'Input.module.css');
const selectJs = read('packages', 'core', 'src', 'ui', 'Select.jsx');
const textareaJs = read('packages', 'core', 'src', 'ui', 'Textarea.jsx');
const amountJs = read('packages', 'core', 'src', 'shared', 'components', 'AmountField.jsx');
const amountCss = read('packages', 'core', 'src', 'shared', 'components', 'AmountField.module.css');
const sendJs = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');

// --- Input: size prop + wrapper class ----------------------------------

assert.match(inputJs, /size = 'md'/, 'Input defaults size to md');
assert.match(inputJs, /\$\{styles\[size\]/, 'Input applies the size class to the field wrapper');

// --- Input CSS: `.lg` is the single source of truth for big-field ------

assert.match(inputCss, /\.lg \.input\s*\{[^}]*min-height:\s*48px/s, '.lg input is 48px');
assert.match(inputCss, /\.lg \.input\s*\{[^}]*font-size:\s*var\(--xc-text-lg\)/s, '.lg input uses text-lg');
assert.match(inputCss, /\.lg \.label\s*\{/, '.lg bumps the label');
// The default (md) input keeps its 36px baseline.
assert.match(inputCss, /\.input\s*\{[^}]*min-height:\s*36px/s, 'default input stays 36px');

// --- Select + Textarea share the same size prop ------------------------

assert.match(selectJs, /size = 'md'/, 'Select takes size');
assert.match(selectJs, /\$\{styles\[size\]/, 'Select applies the size class');
assert.match(textareaJs, /size = 'md'/, 'Textarea takes size');
assert.match(textareaJs, /\$\{styles\[size\]/, 'Textarea applies the size class');

// --- AmountField forwards size; big-field CSS is gone ------------------

assert.match(amountJs, /size = 'md'/, 'AmountField defaults size to md');
assert.match(amountJs, /<Input\s+ref=\{inputRef\}\s+size=\{size\}/s, 'AmountField forwards size to Input');
assert.match(amountJs, /data-size=\{size\}/, 'AmountField tags the wrap with the size for Max positioning');
assert.doesNotMatch(amountCss, /\.bigField/, 'AmountField no longer defines its own bigField rules');
assert.doesNotMatch(amountJs, /fontSize: 'var\(--xc-text-lg\)'/, 'AmountField no longer inlines the big-field style');
// Max button re-anchored to the input box (bottom-anchored, size-keyed).
assert.match(amountCss, /\[data-size='lg'\] \.amountMaxInline\s*\{[^}]*bottom/s, 'Max button offset keyed to size');

// --- Send opts its hero fields into lg ---------------------------------

assert.match(sendJs, /<AddressCombobox\s+size="lg"/s, 'Send To field is lg');
assert.match(sendJs, /<AmountField\s+size="lg"/s, 'Send Amount field is lg');

console.log('field-size-prop smoke OK');
